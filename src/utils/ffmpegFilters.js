/**
 * FFmpeg filter generation utilities for video-to-GIF conversion
 */

/**
 * Builds a 3-part filter for: Normal → Zoomed → Zoom Out
 */
export const buildThreePartFilter = (
  trimRange,
  zoomStartTime,
  zoomEndTime,
  cropRect,
  fps,
  safeWidth,
  safeHeight,
  colors,
  dither
) => {
  return [
    `[0:v]split=3[v_start][v_zoom][v_end]`,
    `[v_start]trim=start=${trimRange[0]}:end=${zoomStartTime},setpts=PTS-STARTPTS,fps=${fps},scale=${safeWidth}:${safeHeight}:flags=lanczos[part1]`,
    `[v_zoom]trim=start=${zoomStartTime}:end=${zoomEndTime},setpts=PTS-STARTPTS,fps=${fps},crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y},scale=${safeWidth}:${safeHeight}:flags=lanczos[part2]`,
    `[v_end]trim=start=${zoomEndTime}:end=${trimRange[1]},setpts=PTS-STARTPTS,fps=${fps},scale=${safeWidth}:${safeHeight}:flags=lanczos[part3]`,
    `[part1][part2][part3]concat=n=3:v=1:a=0[concatenated]`,
    `[concatenated]split[s0][s1]`,
    `[s0]palettegen=max_colors=${colors}[p]`,
    `[s1][p]paletteuse=dither=bayer:bayer_scale=${dither}`
  ].join(';')
}

/**
 * Builds a 2-part filter for: Normal → Zoomed (stays zoomed)
 */
export const buildTwoPartFilter = (
  trimRange,
  zoomStartTime,
  cropRect,
  fps,
  safeWidth,
  safeHeight,
  colors,
  dither
) => {
  return [
    `[0:v]split=2[v_start][v_zoom]`,
    `[v_start]trim=start=${trimRange[0]}:end=${zoomStartTime},setpts=PTS-STARTPTS,fps=${fps},scale=${safeWidth}:${safeHeight}:flags=lanczos[part1]`,
    `[v_zoom]trim=start=${zoomStartTime}:end=${trimRange[1]},setpts=PTS-STARTPTS,fps=${fps},crop=${cropRect.width}:${cropRect.height}:${cropRect.x}:${cropRect.y},scale=${safeWidth}:${safeHeight}:flags=lanczos[part2]`,
    `[part1][part2]concat=n=2:v=1:a=0[concatenated]`,
    `[concatenated]split[s0][s1]`,
    `[s0]palettegen=max_colors=${colors}[p]`,
    `[s1][p]paletteuse=dither=bayer:bayer_scale=${dither}`
  ].join(';')
}

/**
 * Builds a simple trim+scale filter (no zoom/crop)
 */
export const buildSimpleFilter = (trimRange, fps, width, colors, dither) => {
  return `trim=start=${trimRange[0]}:end=${trimRange[1]},setpts=PTS-STARTPTS,fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=${dither}`
}
