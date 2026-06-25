// ── Zwift delivery ───────────────────────────────────────────
// Two ways to get a generated .zwo into Zwift:
//   • download  — universal; the user drops it into Documents/Zwift/Workouts/…
//   • folder sync — hands-off; once they grant their Zwift Workouts folder, we
//     write upcoming sessions straight in (File System Access API, Chromium
//     desktop). The granted directory handle is persisted in IndexedDB so it
//     survives reloads and we can re-sync silently while permission holds.

import { buildZwo, zwoFilename } from './zwo'

const PREFIX = 'wattsToCome-' // our files, so we can prune stale ones on re-sync

// ── Download path (works everywhere) ─────────────────────────
export function downloadZwo(session, ftp, dateLabel = '') {
  const xml = buildZwo(session, ftp, dateLabel)
  if (!xml) return false
  const blob = new Blob([xml], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(dateLabel || session.name || 'workout').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.zwo`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return true
}

// ── Tiny IndexedDB key/value (handles are structured-cloneable) ──
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('wattsToCome', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function idbGet(key) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly').objectStore('kv').get(key)
    tx.onsuccess = () => resolve(tx.result)
    tx.onerror = () => reject(tx.error)
  })
}
async function idbSet(key, val) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(val, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
async function idbDel(key) {
  const db = await idb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite')
    tx.objectStore('kv').delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ── Folder-sync path (File System Access API) ────────────────
export const supportsFolderSync = () =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window

export async function linkZwiftFolder() {
  const handle = await window.showDirectoryPicker({ id: 'zwift-workouts', mode: 'readwrite' })
  await idbSet('zwiftDir', handle)
  return handle
}

export async function loadHandle() {
  try { return (await idbGet('zwiftDir')) || null } catch { return null }
}

export async function forgetHandle() {
  try { await idbDel('zwiftDir') } catch { /* ignore */ }
}

// 'granted' | 'prompt' | 'denied'. Pass request=true (from a user gesture) to
// prompt; otherwise we only query so silent re-syncs never pop a dialog.
export async function permission(handle, request = false) {
  if (!handle) return 'denied'
  const opts = { mode: 'readwrite' }
  let state = await handle.queryPermission(opts)
  if (state !== 'granted' && request) state = await handle.requestPermission(opts)
  return state
}

// Write every item's .zwo into the folder (overwriting), and prune our own
// stale files (sessions that were removed or re-zoned). items: [{ weekNum, idx, xml }].
export async function writeSessions(handle, items) {
  const desired = new Set(items.map(it => zwoFilename(it.weekNum, it.idx)))
  // Prune stale wattsToCome-*.zwo no longer in the plan.
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'file' && name.startsWith(PREFIX) && !desired.has(name)) {
      try { await handle.removeEntry(name) } catch { /* ignore */ }
    }
  }
  let written = 0
  for (const it of items) {
    if (!it.xml) continue
    const fh = await handle.getFileHandle(zwoFilename(it.weekNum, it.idx), { create: true })
    const w = await fh.createWritable()
    await w.write(it.xml)
    await w.close()
    written++
  }
  return written
}
