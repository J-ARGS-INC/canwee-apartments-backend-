// One-off import script for listing videos, mirroring how listing photos
// are stored: raw bytes in Postgres (`listing_videos.data`), served back
// out through server/src/routes/videos.js, never as static frontend files.
//
// Usage:
//   node db/importVideos.js <listing-id> <path/to/video1.mp4> [path/to/video2.mp4 ...]
//
// Only accepts .mp4 (H.264/AAC) input — that's what actually plays back
// reliably in a <video> tag across Chrome, Firefox, and Safari. iPhone
// recordings straight out of the Camera app are usually HEVC (H.265) video
// with LPCM (uncompressed) audio inside a .MOV container, which most
// desktop browsers either can't decode at all (HEVC) or don't support in
// <video> (LPCM) — those need to be re-encoded to H.264/AAC .mp4 first
// (e.g. HandBrake, QuickTime's "Export As" on Mac, or `ffmpeg -i in.mov
// -c:v libx264 -c:a aac -movflags +faststart out.mp4`) before running this
// script. Re-run is safe: existing videos for the listing are replaced,
// not duplicated.
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { pool } from '../src/db.js'

async function importVideos() {
  const [listingId, ...filePaths] = process.argv.slice(2)

  if (!listingId || filePaths.length === 0) {
    console.error('Usage: node db/importVideos.js <listing-id> <path/to/video.mp4> [more.mp4 ...]')
    process.exit(1)
  }

  const nonMp4 = filePaths.filter((path) => extname(path).toLowerCase() !== '.mp4')
  if (nonMp4.length > 0) {
    console.error(`Refusing to import non-.mp4 file(s): ${nonMp4.join(', ')}`)
    console.error('Convert to H.264/AAC .mp4 first (see the comment at the top of this script).')
    process.exit(1)
  }

  const { rows: listingRows } = await pool.query('select id from listings where id = $1', [listingId])
  if (listingRows.length === 0) {
    console.error(`No listing found with id "${listingId}".`)
    await pool.end()
    process.exit(1)
  }

  await pool.query('delete from listing_videos where listing_id = $1', [listingId])

  for (const [index, filePath] of filePaths.entries()) {
    const data = readFileSync(filePath)
    await pool.query(
      'insert into listing_videos (listing_id, sort_order, content_type, data) values ($1, $2, $3, $4)',
      [listingId, index, 'video/mp4', data],
    )
    console.log(`Imported ${filePath} (${(data.length / (1024 * 1024)).toFixed(1)} MB) for ${listingId}`)
  }

  console.log(`Done — ${filePaths.length} video(s) imported for ${listingId}.`)
  await pool.end()
}

importVideos().catch((err) => {
  console.error('Video import failed:', err)
  process.exit(1)
})
