// supabase/functions/_shared/drive-download.ts

export type DriveFile = {
  bytes: Uint8Array
  mimeType: string
  filename: string
}

export async function downloadDriveFile(
  fileId: string,
  accessToken: string,
): Promise<DriveFile> {
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!metaRes.ok) {
    throw new Error(`Drive metadata fetch failed: ${metaRes.status}`)
  }
  const meta = await metaRes.json() as { name: string; mimeType: string }

  // Google-native files (Docs, Sheets, Slides) need an export; binary files use get?alt=media
  const isNative = meta.mimeType.startsWith("application/vnd.google-apps")
  let downloadUrl: string
  let effectiveMime: string
  let effectiveName = meta.name

  if (isNative) {
    const exportMap: Record<string, { mime: string; ext: string }> = {
      "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
      "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: ".pdf" },
      "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: ".csv" },
    }
    const cfg = exportMap[meta.mimeType] ?? { mime: "application/pdf", ext: ".pdf" }
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(cfg.mime)}`
    effectiveMime = cfg.mime
    if (!effectiveName.endsWith(cfg.ext)) effectiveName += cfg.ext
  } else {
    downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
    effectiveMime = meta.mimeType
  }

  const fileRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!fileRes.ok) {
    throw new Error(`Drive download failed: ${fileRes.status}`)
  }
  const bytes = new Uint8Array(await fileRes.arrayBuffer())
  return { bytes, mimeType: effectiveMime, filename: effectiveName }
}
