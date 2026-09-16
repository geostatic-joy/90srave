/*
 * FLAC encoder worker.
 *
 * Plain (classic) worker on purpose: libflac.js is an emscripten build that
 * has to come in through importScripts(), and it locates its .wasm relative to
 * this file. It is therefore served from public/ rather than bundled.
 *
 * Message in:  { libUrl, libDir, sampleRate, channels: Float32Array[], compression }
 * Messages out: { type: 'progress', value } | { type: 'done', bytes } | { type: 'error', message }
 */

var BLOCK_SAMPLES = 16384

function fail(message) {
  self.postMessage({ type: 'error', message: message })
}

function mergeChunks(chunks) {
  var length = 0
  for (var i = 0; i < chunks.length; i++) length += chunks[i].length
  var out = new Uint8Array(length)
  var offset = 0
  for (var j = 0; j < chunks.length; j++) {
    out.set(chunks[j], offset)
    offset += chunks[j].length
  }
  return out
}

/*
 * libflac streams STREAMINFO before it knows the frame sizes, total sample
 * count or MD5, so those fields are patched in afterwards from the metadata
 * callback. Same fix-up libflacjs's own flac-utils performs.
 */
function patchStreamInfo(chunks, metadata) {
  if (!metadata || chunks.length === 0) return
  var offset = 4
  var data = chunks[0]
  if (data.length < 4 || String.fromCharCode(data[0], data[1], data[2], data[3]) !== 'fLaC') return
  if (data.length === 4) {
    if (chunks.length < 2) return
    data = chunks[1]
    offset = 0
  }
  if (data.length < offset + 38) return
  var view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  view.setUint8(offset + 8, metadata.min_framesize >> 16)
  view.setUint8(offset + 9, metadata.min_framesize >> 8)
  view.setUint8(offset + 10, metadata.min_framesize)
  view.setUint8(offset + 11, metadata.max_framesize >> 16)
  view.setUint8(offset + 12, metadata.max_framesize >> 8)
  view.setUint8(offset + 13, metadata.max_framesize)
  view.setUint8(offset + 18, metadata.total_samples >> 24)
  view.setUint8(offset + 19, metadata.total_samples >> 16)
  view.setUint8(offset + 20, metadata.total_samples >> 8)
  view.setUint8(offset + 21, metadata.total_samples)
  var md5 = metadata.md5sum || ''
  for (var i = 0; i * 2 + 1 < md5.length && i < 16; i++) {
    view.setUint8(offset + 22 + i, parseInt(md5.substr(i * 2, 2), 16))
  }
}

function encode(Flac, request) {
  var channels = request.channels
  var numChannels = channels.length
  var totalSamples = channels[0].length
  var sampleRate = request.sampleRate
  var compression = typeof request.compression === 'number' ? request.compression : 5

  var encoder = Flac.create_libflac_encoder(sampleRate, numChannels, 16, compression, totalSamples, false, 0)
  if (!encoder) throw new Error('libflac could not create an encoder')

  var chunks = []
  var metadata = null
  var status = Flac.init_encoder_stream(
    encoder,
    function (buffer) {
      chunks.push(new Uint8Array(buffer))
      return true
    },
    function (block) {
      metadata = block
    },
  )
  if (status !== 0) {
    Flac.FLAC__stream_encoder_delete(encoder)
    throw new Error('libflac encoder init failed with status ' + status)
  }

  var scratch = new Int32Array(BLOCK_SAMPLES * numChannels)
  try {
    for (var offset = 0; offset < totalSamples; offset += BLOCK_SAMPLES) {
      var count = Math.min(BLOCK_SAMPLES, totalSamples - offset)
      var view = count === BLOCK_SAMPLES ? scratch : scratch.subarray(0, count * numChannels)
      for (var i = 0; i < count; i++) {
        for (var c = 0; c < numChannels; c++) {
          var sample = channels[c][offset + i]
          if (sample > 1) sample = 1
          else if (sample < -1) sample = -1
          view[i * numChannels + c] = Math.round(sample < 0 ? sample * 32768 : sample * 32767)
        }
      }
      if (!Flac.FLAC__stream_encoder_process_interleaved(encoder, view, count)) {
        throw new Error('libflac rejected a block of samples')
      }
      self.postMessage({ type: 'progress', value: offset / totalSamples })
    }
    Flac.FLAC__stream_encoder_finish(encoder)
  } finally {
    Flac.FLAC__stream_encoder_delete(encoder)
  }

  patchStreamInfo(chunks, metadata)
  return mergeChunks(chunks)
}

self.onmessage = function (event) {
  var request = event.data
  try {
    if (request.libDir) self.FLAC_SCRIPT_LOCATION = request.libDir
    if (!self.Flac) importScripts(request.libUrl)
  } catch (error) {
    fail('Could not load the FLAC encoder: ' + (error && error.message ? error.message : error))
    return
  }

  var Flac = self.Flac
  if (!Flac) {
    fail('The FLAC encoder did not load.')
    return
  }

  var run = function () {
    try {
      var bytes = encode(Flac, request)
      self.postMessage({ type: 'done', bytes: bytes }, [bytes.buffer])
    } catch (error) {
      fail(error && error.message ? error.message : String(error))
    }
  }

  if (Flac.isReady()) {
    run()
  } else {
    Flac.on('ready', run)
  }
}
