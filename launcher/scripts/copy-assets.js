// renderer の静的アセット（HTML/CSS/JS）は tsc の対象外なので dist にコピーする。
const fs = require('node:fs')
const path = require('node:path')

const src = path.join(__dirname, '..', 'src', 'renderer')
const dest = path.join(__dirname, '..', 'dist', 'renderer')

fs.cpSync(src, dest, { recursive: true })
console.log(`renderer assets copied: ${src} -> ${dest}`)
