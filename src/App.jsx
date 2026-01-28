import { useState, useRef } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import VideoCanvas from './VideoCanvas'
import './App.css'

function App() {
  const [videoFile, setVideoFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [showSettings, setShowSettings] = useState(false) // Default collapsed
  const [cropRect, setCropRect] = useState(null)
  const [zoomStartTime, setZoomStartTime] = useState(null)
  const [zoomEndTime, setZoomEndTime] = useState(null)
  const [trimRange, setTrimRange] = useState([0, 0]) // [start, end]
  const [currentTime, setCurrentTime] = useState(0)
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
        setProgress(Math.round(progress * 100))
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
      setProcessing(true)
      setProgress(0)

      const ffmpeg = await loadFFmpeg()
      const videoDuration = await getVideoDuration()

      // Write video file to ffmpeg filesystem
      await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile))

      // Build filter string based on settings
      const { fps, width, colors, dither, loop } = exportSettings

      // STAGE 2: Zoom/Crop Logic with Zoom In/Out support
      if (cropRect && zoomStartTime !== null && zoomStartTime > 0) {
        console.log('Exporting with Zoom:', { zoomStartTime, zoomEndTime })

        // Calculate target height to maintain aspect ratio
        const videoElement = document.createElement('video')
        videoElement.src = URL.createObjectURL(videoFile)
        await new Promise(r => videoElement.onloadedmetadata = r)
        const videoAspect = videoElement.videoWidth / videoElement.videoHeight
        const targetHeight = Math.round(width / videoAspect)

        // Ensure even dimensions for ffmpeg
        const safeWidth = width % 2 === 0 ? width : width - 1
        const safeHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight - 1

        console.log(`Target Output: ${safeWidth}x${safeHeight}`)

        let filterComplex

        if (zoomEndTime !== null && zoomEndTime > zoomStartTime) {
          // 3-PART: Normal → Zoomed → Zoom Out
          console.log('3-part export: Normal → Zoomed → Zoom Out')

          filterComplex = [
            // Split into 3 streams
            `[0:v]split=3[v_start][v_zoom][v_end]`,

            // Part 1: Normal (before zoom)
            `[v_start]trim=start=${trimRange[0]}:end=${zoomStartTime},setpts=PTS-STARTPTS,fps=${fps},scale=${safeWidth}:${safeHeight}:flags=lanczos[part1]`,

            // Part 2: Zoomed (during zoom)
            `[v_zoom]trim=start=${zoomStartTime}:end=${zoomEndTime},setpts=PTS-STARTPTS,fps=${fps},crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y},scale=${safeWidth}:${safeHeight}:flags=lanczos[part2]`,

            // Part 3: Normal (after zoom out)
            `[v_end]trim=start=${zoomEndTime}:end=${trimRange[1]},setpts=PTS-STARTPTS,fps=${fps},scale=${safeWidth}:${safeHeight}:flags=lanczos[part3]`,

            // Concat all 3 parts
            `[part1][part2][part3]concat=n=3:v=1:a=0[concatenated]`,

            // GIF Generation
            `[concatenated]split[s0][s1]`,
            `[s0]palettegen=max_colors=${colors}[p]`,
            `[s1][p]paletteuse=dither=bayer:bayer_scale=${dither}`
          ].join(';')
        } else {
          // 2-PART: Normal → Zoomed (no zoom out)
          console.log('2-part export: Normal → Zoomed')

          filterComplex = [
            `[0:v]split=2[v_start][v_zoom]`,

            // Part 1: Normal (before zoom)
            `[v_start]trim=start=${trimRange[0]}:end=${zoomStartTime},setpts=PTS-STARTPTS,fps=${fps},scale=${safeWidth}:${safeHeight}:flags=lanczos[part1]`,

            // Part 2: Zoomed (stays zoomed)
            `[v_zoom]trim=start=${zoomStartTime}:end=${trimRange[1]},setpts=PTS-STARTPTS,fps=${fps},crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y},scale=${safeWidth}:${safeHeight}:flags=lanczos[part2]`,

            // Concat
            `[part1][part2]concat=n=2:v=1:a=0[concatenated]`,

            // GIF Generation
            `[concatenated]split[s0][s1]`,
            `[s0]palettegen=max_colors=${colors}[p]`,
            `[s1][p]paletteuse=dither=bayer:bayer_scale=${dither}`
          ].join(';')
        }

        console.log('Filter Graph:', filterComplex)

        await ffmpeg.exec([
          '-i', 'input.mp4',
          '-filter_complex', filterComplex,
          '-loop', loop.toString(),
          'output.gif'
        ])
        console.log('Export complete')

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
        // STAGE 1: Basic full video export with trimming
        // Recalculate duration based on trim
        // Note: ffmpeg trim filter doesn't auto-reset PTS for duration metadata sometimes, but setpts=PTS-STARTPTS fixes the frames.

        const filter = `trim=start=${trimRange[0]}:end=${trimRange[1]},setpts=PTS-STARTPTS,fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=${dither}`
        console.log('Exporting video with trim:', trimRange)

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

      setProcessing(false)
      setProgress(0)
    } catch (error) {
      console.error('Export failed:', error)
      setProcessing(false)
      setProgress(0)
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
            onCropChange={(rect) => {
              setCropRect(rect)
              if (!rect) {
                // Clear zoom markers only when "Clear Crop" is clicked
                setZoomEndTime(null)
                setZoomStartTime(null)
              }
              // Note: zoom in marker is set by VideoCanvas via onZoomTimeChange
            }}
            onZoomTimeChange={setZoomStartTime}
            externalCropRect={cropRect}
            trimRange={trimRange}
            onTrimChange={setTrimRange}
            zoomTime={zoomStartTime}
            zoomEndTime={zoomEndTime}
            onZoomEndTimeChange={(time) => {
              console.log('📥 App.jsx setting zoom end time:', time.toFixed(2), 'current:', zoomEndTime?.toFixed(2))
              setZoomEndTime(time)
            }}
            onCurrentTimeChange={setCurrentTime}
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
                <button
                  className="button-primary"
                  onClick={handleExport}
                  disabled={processing}
                  style={{ marginTop: '12px', width: '100%' }}
                >
                  {processing ? `Exporting... ${progress}%` : 'Export GIF'}
                </button>
              </div>
            </div>

            {/* STAGE 2: Crop UI enabled */}
            {true && (
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
                          Zoom at {(zoomStartTime - trimRange[0]).toFixed(1)}s

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
                      {zoomStartTime !== null && zoomEndTime === null && (
                        <button
                          style={{
                            marginTop: '8px',
                            marginLeft: '8px',
                            padding: '6px 12px',
                            backgroundColor: 'var(--surface-2)',
                            color: '#e67e22',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 'var(--radius)',
                            fontSize: '12px',
                            fontFamily: 'var(--font-mono)',
                          }}
                          onClick={() => {
                            // Set zoom end time to current playhead position
                            const end = Math.max(zoomStartTime + 0.5, Math.min(trimRange[1], currentTime))
                            console.log('🟠 Setting zoom out at playhead:', {
                              currentTime,
                              zoomStartTime,
                              zoomEndTime: end,
                              trimRange,
                              duration: end - zoomStartTime
                            })
                            setZoomEndTime(end)
                          }}
                        >
                          Add Zoom Out
                        </button>
                      )}
                    </>
                  ) : (
                    <p style={{
                      fontSize: '12px',
                      color: 'var(--text-disabled)',
                    }}>
                      Select an area in the video to zoom in
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="settings-section">
              <button
                onClick={() => setShowSettings(!showSettings)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  color: 'var(--text-primary)',
                  marginBottom: showSettings ? '16px' : '0'
                }}
              >
                <h2 style={{ margin: 0 }}>Export Settings</h2>
                <span style={{
                  transform: showSettings ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s ease'
                }}>
                  ▼
                </span>
              </button>

              {showSettings && (
                <div className="settings-content" style={{ animation: 'fadeIn 0.2s ease' }}>
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


                </div>
              )}
            </div>

            <div className="timeline-container" style={{ padding: '0 12px', boxSizing: 'border-box' }}>
              {/* Timeline control is now inside VideoCanvas, but we might want to move it out later. 
                  For now, VideoCanvas handles the rendering of the timeline. 
                  Wait, VideoCanvas renders inside .canvas-area. 
                  The user prompt implies we want to edit timeline. 
                  
                  Let's CLEANUP the old placeholder.
              */}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default App
