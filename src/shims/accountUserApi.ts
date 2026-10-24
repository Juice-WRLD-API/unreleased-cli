export * from 'site:userApi'

// A CLI has no canvas. Send already-sized images directly, with a useful
// error for an avatar that needs resizing before it can reach the API.
export async function compressImageFile(file: File, _maxDim = 400, maxKB = 200): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('choose a PNG, JPEG, GIF or WebP image')
  if (file.size > maxKB * 1024) throw new Error(`resize the image to ${maxKB} KB or less first`)
  return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`
}
