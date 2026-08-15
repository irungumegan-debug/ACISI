export interface StkPushRequest {
  amountKes: number;
  phoneNumberE164: string;
  accountReference: string;
  transactionDesc: string;
}

export interface StkPushResponse {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
}

/** Body of Daraja's callback to MPESA_CALLBACK_URL after the customer acts on the STK prompt. */
export interface StkCallbackPayload {
  Body: {
    stkCallback: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: {
        Item: Array<{ Name: string; Value?: string | number }>;
      };
    };
  };
}

export interface ParsedStkCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amountKes?: number;
  mpesaReceiptNumber?: string;
  transactionDate?: Date;
  phoneNumber?: string;
}

export type StkQueryResultCode = '0' | '1032' | '1037' | '2001' | string;

export interface StkQueryResponse {
  resultCode: StkQueryResultCode;
  resultDesc: string;
  merchantRequestId: string;
  checkoutRequestId: string;
}
