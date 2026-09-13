import { createElement, useCallback, useState } from 'react';
import BoxWeightDialog from '../components/common/BoxWeightDialog';
import { BOX_WEIGHT_ERROR_CODES, getBoxWeightErrorCode, getBoxWeightErrorDetails } from './boxWeight';

// Promise-based prompt so existing async handlers can pause, ask for a weight, then retry.
export const useBoxWeightPrompt = ({ apiBaseUrl = '', buildHeaders, parseResponse }) => {
  const [request, setRequest] = useState(null);

  const requestBoxWeight = useCallback(
    (options = {}) =>
      new Promise((resolve) => {
        setRequest((previous) => {
          previous?.resolve(null);
          return { id: `${Date.now()}-${Math.random()}`, ...options, resolve };
        });
      }),
    []
  );

  // Handles the seal/dispatch 422s: asks for the weight, saves it on the box, returns true so the caller can retry.
  const resolveBoxWeightBlocker = useCallback(
    async (error) => {
      const code = getBoxWeightErrorCode(error);
      if (!BOX_WEIGHT_ERROR_CODES.includes(code)) return false;
      const details = getBoxWeightErrorDetails(error);
      if (!details.boxId) return false;

      const confirmed = await requestBoxWeight({
        reason: code === 'BOX_WEIGHT_REQUIRED' ? 'required' : 'over-limit',
        weightKg: details.weightKg,
        boxLabel: details.boxLabel,
      });
      if (!confirmed) return false;

      const response = await fetch(`${apiBaseUrl}/api/boxes/${encodeURIComponent(details.boxId)}`, {
        method: 'PATCH',
        headers: buildHeaders(true),
        body: JSON.stringify(confirmed),
      });
      await parseResponse(response);
      return true;
    },
    [apiBaseUrl, buildHeaders, parseResponse, requestBoxWeight]
  );

  const boxWeightPrompt = request
    ? createElement(BoxWeightDialog, {
        key: request.id,
        request,
        onSubmit: (value) => {
          setRequest(null);
          request.resolve(value);
        },
        onCancel: () => {
          setRequest(null);
          request.resolve(null);
        },
      })
    : null;

  return { boxWeightPrompt, requestBoxWeight, resolveBoxWeightBlocker };
};
