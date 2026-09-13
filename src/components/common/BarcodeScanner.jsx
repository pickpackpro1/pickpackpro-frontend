import { useEffect, useRef, useState } from 'react';

// Retail barcodes (EAN/UPC), FNSKU labels (Code 128) and the usual warehouse extras.
const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'qr_code', 'data_matrix'];
const SCAN_INTERVAL_MS = 200;

let detectorPromise = null;

// Loaded on first open so the ~1 MB decoder never touches pages that don't scan.
// The .wasm is bundled with the app instead of the library's default CDN download.
const loadDetector = () => {
  if (!detectorPromise) {
    detectorPromise = Promise.all([
      import('barcode-detector/ponyfill'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ])
      .then(([{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }]) => {
        prepareZXingModule({
          overrides: {
            locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
          },
        });
        return new BarcodeDetector({ formats: SCAN_FORMATS });
      })
      .catch((error) => {
        detectorPromise = null;
        throw error;
      });
  }
  return detectorPromise;
};

const describeCameraError = (error) => {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access is blocked. Allow the camera for this site in your browser settings, or type the barcode below.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera found on this device. Type the barcode below.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is being used by another app. Close it and try again, or type the barcode below.';
  }
  if (name === 'NotSupportedError' || !window.isSecureContext) {
    return "This browser can't open the camera here. Type the barcode below.";
  }
  return `Couldn't start the scanner${error?.message ? ` (${error.message})` : ''}. Type the barcode below.`;
};

const BarcodeScanner = ({ title = 'Scan barcode', onDetected, onClose }) => {
  const videoRef = useRef(null);
  const onDetectedRef = useRef(onDetected);
  const [status, setStatus] = useState('starting');
  const [cameraError, setCameraError] = useState('');
  const [manualCode, setManualCode] = useState('');

  useEffect(() => {
    onDetectedRef.current = onDetected;
  });

  useEffect(() => {
    let stream = null;
    let stopped = false;
    let timer = null;

    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Object.assign(new Error('Camera API unavailable'), { name: 'NotSupportedError' });
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stopped) {
          stop();
          return;
        }
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        const detector = await loadDetector();
        if (stopped) return;
        setStatus('scanning');

        const scanFrame = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const results = await detector.detect(video);
              const code = results.find((result) => result.rawValue)?.rawValue?.trim();
              if (code && !stopped) {
                stop();
                navigator.vibrate?.(80);
                onDetectedRef.current?.(code);
                return;
              }
            }
          } catch {
            // An unreadable frame is normal while the camera focuses; keep going.
          }
          timer = setTimeout(scanFrame, SCAN_INTERVAL_MS);
        };
        scanFrame();
      } catch (error) {
        if (stopped) return;
        stop();
        setStatus('error');
        setCameraError(describeCameraError(error));
      }
    };

    start();
    return stop;
  }, []);

  const submitManual = (event) => {
    event.preventDefault();
    const code = manualCode.trim();
    if (code) onDetected(code);
  };

  return (
    <div className="fixed inset-0 z-[170] flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <h2 className="text-base font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold">
          Close
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {status !== 'error' ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-[80%] max-w-md rounded-xl border-4 border-[#ff6900]/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        ) : null}
        <p className="absolute inset-x-0 bottom-3 text-center text-sm font-medium text-white drop-shadow">
          {status === 'starting' ? 'Starting camera…' : status === 'scanning' ? 'Point the camera at the barcode' : ''}
        </p>
        {status === 'error' ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <p className="rounded-xl bg-white px-4 py-3 text-center text-sm text-gray-800">{cameraError}</p>
          </div>
        ) : null}
      </div>

      <form onSubmit={submitManual} className="flex gap-2 bg-white px-4 py-3">
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          value={manualCode}
          onChange={(event) => setManualCode(event.target.value)}
          onKeyDown={(event) => {
            // Scanner guns end every scan with Enter; handle it here rather than relying on implicit form submit.
            if (event.key === 'Enter') submitManual(event);
          }}
          placeholder="Or type / use a scanner gun"
          className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#ff6900]"
        />
        <button type="submit" className="rounded-lg bg-[#ff6900] px-4 py-3 text-sm font-semibold text-white">
          Use
        </button>
      </form>
    </div>
  );
};

export default BarcodeScanner;
