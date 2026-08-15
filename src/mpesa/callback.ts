import { ParsedStkCallback, StkCallbackPayload } from './types';

function metadataValue(
  items: Array<{ Name: string; Value?: string | number }> | undefined,
  name: string,
): string | number | undefined {
  return items?.find((item) => item.Name === name)?.Value;
}

/** Normalizes Daraja's verbose CallbackMetadata array into a flat, typed shape. */
export function parseStkCallback(payload: StkCallbackPayload): ParsedStkCallback {
  const { stkCallback } = payload.Body;
  const items = stkCallback.CallbackMetadata?.Item;

  const amount = metadataValue(items, 'Amount');
  const receipt = metadataValue(items, 'MpesaReceiptNumber');
  const date = metadataValue(items, 'TransactionDate');
  const phone = metadataValue(items, 'PhoneNumber');

  return {
    merchantRequestId: stkCallback.MerchantRequestID,
    checkoutRequestId: stkCallback.CheckoutRequestID,
    resultCode: stkCallback.ResultCode,
    resultDesc: stkCallback.ResultDesc,
    amountKes: typeof amount === 'number' ? amount : undefined,
    mpesaReceiptNumber: typeof receipt === 'string' ? receipt : undefined,
    transactionDate: typeof date === 'number' ? parseDarajaTransactionDate(date) : undefined,
    phoneNumber: phone !== undefined ? String(phone) : undefined,
  };
}

/** Daraja sends transaction dates as a number like 20240115143022 (yyyyMMddHHmmss). */
function parseDarajaTransactionDate(value: number): Date {
  const s = String(value);
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6)) - 1;
  const day = Number(s.slice(6, 8));
  const hour = Number(s.slice(8, 10));
  const minute = Number(s.slice(10, 12));
  const second = Number(s.slice(12, 14));
  return new Date(year, month, day, hour, minute, second);
}
