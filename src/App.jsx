import { useState, useRef } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import VideoCanvas from './VideoCanvas'
import './App.css'

function App() {
  const [videoFile, setVideoFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [cropRect, setCropRect] = useState(null)
  const [zoomStartTime, setZoomStartTime] = useState(null)
  const [exportSettings, setExportSettings] = useState({
    fps: 15,
    width: 600,
    colors: 256,
    dither: 5,
    loop: 0,
    quality: 'high'
  })
  const fileInputRef = useRef(null)
  const ffmpegRef = useRef(null)
  const videoMetadataRef = useRef({ duration: 0 })

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setDragOver(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)

    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file)
    }
  }

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (file && file.type.startsWith('video/')) {
      setVideoFile(file)
    }
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const loadFFmpeg = async () => {
    if (!ffmpegRef.current) {
      const ffmpeg = new FFmpeg()

      ffmpeg.on('log', ({ message }) => {
        console.log(message)
      })

      ffmpeg.on('progress', ({ progress }) => {
        setExportProgress(Math.round(progress * 100))
      })

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      })

      ffmpegRef.current = ffmpeg
    }
    return ffmpegRef.current
  }

  const getVideoDuration = () => {
    return new Promise((resolve) => {
      const video = document.createElement('video')
      video.src = URL.createObjectURL(videoFile)
      video.onloadedmetadata = () => {
        resolve(video.duration)
        URL.revokeObjectURL(video.src)
      }
    })
  }

  const handleExport = async () => {
    if (!videoFile) return

    try {
      setIsExporting(true)
      setExportProgress(0)

      const ffmpeg = await loadFFmpeg()
      const videoDuration = await getVideoDuration()

      // Write video file to ffmpeg filesystem
      await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile))

      // Build filter string based on settings
      const { fps, width, colors, dither, loop } = exportSettings

      // STAGE 1: Crop disabled - simple export only
      // TODO: Re-enable crop in Stage 2
      if (false && cropRect && zoomStartTime !== null && zoomStartTime > 0) {
        console.log('Creating hard cut zoom at', zoomStartTime, 's')
        console.log('Video duration:', videoDuration, 's')

        // Create a shared palette for consistent colors
        const paletteFilter = `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=max_colors=${colors}`
        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-vf', paletteFilter,
          'palette.png'
        ])
        console.log('Palette created')

        // Part 1: Full video until zoom time (as raw frames)
        console.log('Creating part 1: 0 to', zoomStartTime)
        const filter1 = `fps=${fps},scale=${width}:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=${dither}`
        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-i', 'palette.png',
          '-t', zoomStartTime.toString(),
          '-lavfi', filter1,
          '-f', 'gif',
          'part1.gif'
        ])
        console.log('Part 1 created')

        // Part 2: Cropped video from zoom time to end
        console.log('Creating part 2:', zoomStartTime, 'to end')
        const filter2 = `crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y},fps=${fps},scale=${width}:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=${dither}`
        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-i', 'palette.png',
          '-ss', zoomStartTime.toString(),
          '-lavfi', filter2,
          '-f', 'gif',
          'part2.gif'
        ])
        console.log('Part 2 created')

        // Check file sizes
        const part1 = await ffmpeg.readFile('part1.gif')
        const part2 = await ffmpeg.readFile('part2.gif')
        console.log('Part 1 size:', part1.length, 'bytes')
        console.log('Part 2 size:', part2.length, 'bytes')

        // Concatenate GIFs - convert to raw frames first
        console.log('Concatenating GIF parts')

        // Extract frames from both GIFs and concat
        await ffmpeg.exec([
          '-i', 'part1.gif',
          '-i', 'part2.gif',
          '-filter_complex', '[0:v]format=rgb24[v0];[1:v]format=rgb24[v1];[v0][v1]concat=n=2:v=1:a=0,split[s0][s1];[s0]palettegen=max_colors=' + colors + '[p];[s1][p]paletteuse=dither=bayer:bayer_scale=' + dither,
          '-loop', loop.toString(),
          'output.gif'
        ])
        console.log('GIF concatenated')

        // Cleanup
        await ffmpeg.deleteFile('part1.gif')
        await ffmpeg.deleteFile('part2.gif')
        await ffmpeg.deleteFile('palette.png')

      } else if (false && cropRect) {
        // Static crop for entire video (DISABLED - Stage 1)
        const filter = `crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y},fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=${dither}`
        console.log('Exporting with crop:', cropRect)

        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-vf', filter,
          '-loop', loop.toString(),
          'output.gif'
        ])
      } else {
        // STAGE 1: Basic full video export (crop disabled)
        const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=${dither}`
        console.log('STAGE 1: Exporting full video (crop disabled)')

        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-vf', filter,
          '-loop', loop.toString(),
          'output.gif'
        ])
      }

      // Read the output GIF
      const data = await ffmpeg.readFile('output.gif')

      // Create download link
      const blob = new Blob([data.buffer], { type: 'image/gif' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = videoFile.name.replace(/\.[^/.]+$/, '') + '.gif'
      a.click()
      URL.revokeObjectURL(url)

      // Cleanup
      await ffmpeg.deleteFile('input.mp4')
      await ffmpeg.deleteFile('output.gif')

      setIsExporting(false)
      setExportProgress(0)
    } catch (error) {
      console.error('Export failed:', error)
      setIsExporting(false)
      setExportProgress(0)
      alert('Export failed. Check console for details.')
    }
  }

  const applyPreset = (preset) => {
    const presets = {
      high: { fps: 15, width: 800, colors: 256, dither: 5, loop: 0, quality: 'high' },
      medium: { fps: 12, width: 600, colors: 128, dither: 4, loop: 0, quality: 'medium' },
      low: { fps: 10, width: 480, colors: 64, dither: 3, loop: 0, quality: 'low' },
    }
    setExportSettings(presets[preset])
  }

  return (
    <div className="app">
      {/* Canvas Area */}
      <div className="canvas-area">
        {!videoFile ? (
          <div
            className={`upload-area ${dragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <h2>Drop video here</h2>
            <p>or</p>
            <button className="upload-button" onClick={handleUploadClick}>
              Select File
            </button>
            <p>MP4, MOV, WebM • Max 500MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>
        ) : (
          <VideoCanvas
            videoFile={videoFile}
            onCropChange={setCropRect}
            onZoomTimeChange={setZoomStartTime}
            externalCropRect={cropRect}
          />
        )}
      </div>

      {/* Settings Panel */}
      <div className="settings-panel">
        <div className="settings-section">
          <h2>2GIF</h2>
        </div>

        {videoFile && (
          <>
            <div className="settings-section">
              <h2>Video</h2>
              <div className="control-group">
                <div className="control-label">File</div>
                <p style={{
                  fontSize: '13px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text-secondary)',
                  wordBreak: 'break-all'
                }}>
                  {videoFile.name}
                </p>
              </div>
            </div>

            {/* STAGE 1: Crop UI hidden */}
            {false && (
              <div className="settings-section">
                <h2>Crop</h2>
                <div className="control-group">
                  {cropRect ? (
                    <>
                      <div className="control-label">Selection</div>
                      <p style={{
                        fontSize: '13px',
                        fontFamily: 'var(--font-mono)',
                        color: 'var(--text-primary)',
                      }}>
                        {cropRect.width}×{cropRect.height}
                      </p>
                      {zoomStartTime !== null && (
                        <p style={{
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--success)',
                          marginTop: '4px'
                        }}>
                          Zoom at {zoomStartTime.toFixed(1)}s
                        </p>
                      )}
                      <button
                        style={{
                          marginTop: '8px',
                          padding: '6px 12px',
                          backgroundColor: 'var(--surface-2)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius)',
                          fontSize: '12px',
                          fontFamily: 'var(--font-mono)',
                        }}
                        onClick={() => {
                          setCropRect(null)
                          setZoomStartTime(null)
                        }}
                      >
                        Clear Crop
                      </button>
                    </>
                  ) : (
                    <p style={{
                      fontSize: '12px',
                      color: 'var(--text-disabled)',
                    }}>
                      Draw on video to crop
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="settings-section">
              <h2>Export Settings</h2>

              <div className="control-group">
                <label className="control-label">Quality Preset</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    style={{
                      flex: 1,
                      padding: '8px',
                      backgroundColor: exportSettings.quality === 'high' ? 'var(--surface-hover)' : 'var(--surface-2)',
                      color: 'var(--text-primary)',
                      border: exportSettings.quality === 'high' ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                    }}
                    onClick={() => applyPreset('high')}
                  >
                    High
                  </button>
                  <button
                    style={{
                      flex: 1,
                      padding: '8px',
                      backgroundColor: exportSettings.quality === 'medium' ? 'var(--surface-hover)' : 'var(--surface-2)',
                      color: 'var(--text-primary)',
                      border: exportSettings.quality === 'medium' ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                    }}
                    onClick={() => applyPreset('medium')}
                  >
                    Medium
                  </button>
                  <button
                    style={{
                      flex: 1,
                      padding: '8px',
                      backgroundColor: exportSettings.quality === 'low' ? 'var(--surface-hover)' : 'var(--surface-2)',
                      color: 'var(--text-primary)',
                      border: exportSettings.quality === 'low' ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius)',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                    }}
                    onClick={() => applyPreset('low')}
                  >
                    Low
                  </button>
                </div>
              </div>

              <div className="control-group">
                <label className="control-label">
                  FPS <span style={{ color: 'var(--text-primary)' }}>{exportSettings.fps}</span>
                </label>
                <input
                  type="range"
                  min="5"
                  max="30"
                  step="1"
                  value={exportSettings.fps}
                  onChange={(e) => setExportSettings({ ...exportSettings, fps: parseInt(e.target.value), quality: 'custom' })}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="control-group">
                <label className="control-label">
                  Width <span style={{ color: 'var(--text-primary)' }}>{exportSettings.width}px</span>
                </label>
                <input
                  type="range"
                  min="320"
                  max="1200"
                  step="40"
                  value={exportSettings.width}
                  onChange={(e) => setExportSettings({ ...exportSettings, width: parseInt(e.target.value), quality: 'custom' })}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="control-group">
                <label className="control-label">
                  Colors <span style={{ color: 'var(--text-primary)' }}>{exportSettings.colors}</span>
                </label>
                <input
                  type="range"
                  min="32"
                  max="256"
                  step="32"
                  value={exportSettings.colors}
                  onChange={(e) => setExportSettings({ ...exportSettings, colors: parseInt(e.target.value), quality: 'custom' })}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="control-group">
                <label className="control-label">
                  Dither <span style={{ color: 'var(--text-primary)' }}>{exportSettings.dither}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="1"
                  value={exportSettings.dither}
                  onChange={(e) => setExportSettings({ ...exportSettings, dither: parseInt(e.target.value), quality: 'custom' })}
                  style={{ width: '100%' }}
                />
                <p style={{
                  fontSize: '11px',
                  color: 'var(--text-disabled)',
                  marginTop: '4px'
                }}>
                  Higher = smoother gradients, larger file
                </p>
              </div>

              <div className="control-group">
                <label className="control-label">Loop</label>
                <select
                  value={exportSettings.loop}
                  onChange={(e) => setExportSettings({ ...exportSettings, loop: parseInt(e.target.value), quality: 'custom' })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: 'var(--surface-2)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px'
                  }}
                >
                  <option value="0">Loop forever</option>
                  <option value="-1">Play once</option>
                  <option value="1">Loop 1 time</option>
                  <option value="2">Loop 2 times</option>
                  <option value="3">Loop 3 times</option>
                  <option value="5">Loop 5 times</option>
                  <option value="10">Loop 10 times</option>
                </select>
              </div>

              <button
                className="button-primary"
                onClick={handleExport}
                disabled={isExporting}
                style={{ marginTop: '16px' }}
              >
                {isExporting ? `Exporting... ${exportProgress}%` : 'Export GIF'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Timeline */}
      <div className="timeline">
        {!videoFile ? (
          <div className="timeline-placeholder">
            Timeline will appear here
          </div>
        ) : (
          <div className="timeline-placeholder">
            Timeline controls coming soon
          </div>
        )}
      </div>
    </div>
  )
}

export default App
