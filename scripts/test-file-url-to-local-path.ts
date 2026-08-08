import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { localPathFromFileUrl } from '../electron/services/fileUrlPath.ts'

const abs = '/Users/kelaocai/Documents/CipherTalkData/Images/meeaaw/2021-04/x_hd.jpg'
const withQuery = `${pathToFileURL(abs).toString()}?v=1785329966729`

assert.equal(
  localPathFromFileUrl(withQuery),
  abs,
  'file:///…?v=… must keep leading slash on macOS/Linux',
)

assert.equal(
  localPathFromFileUrl(pathToFileURL(abs).toString()),
  abs,
  'file:/// without query must round-trip',
)

assert.equal(
  localPathFromFileUrl(abs),
  abs,
  'plain absolute paths must pass through',
)

console.log('file url to local path: ok')
