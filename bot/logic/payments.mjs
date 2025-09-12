import { YooCheckout } from '@a2seven/yoo-checkout';
import crypto from 'crypto'
import { config } from 'dotenv';
config();

// Нормализуем телефон для чеков YooKassa: только цифры, без плюса
function normalizePhoneForReceipt(phone) {
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D/g, '');
  return digits || undefined;
}

// Формируем чек для платежа комиссии
function buildPaymentReceipt({ description, phone, seats, perSeat, taxSystemCode }) {
  if (!phone || !seats || !perSeat) return undefined;
  const vatCode = parseInt(process.env.YOOKASSA_VAT_CODE || '6', 10); // 6 — без НДС
  const items = [
    {
      description: description?.slice(0, 128) || 'Комиссия сервиса',
      amount: { value: Number(perSeat).toFixed(2), currency: 'RUB' },
      quantity: Number(seats),
      vat_code: vatCode,
      payment_mode: 'full_prepayment',
      payment_subject: 'service'
    }
  ];
  const receipt = {
    customer: { phone },
    items,
  };
  return receipt;
}

// Формируем чек для возврата комиссии
function buildRefundReceipt({ description, phone, seats, perSeat, taxSystemCode }) {
  if (!phone || !seats || !perSeat) return undefined;
  const vatCode = 6
  const items = [
    {
      description: description?.slice(0, 128) || 'Возврат комиссии сервиса',
      amount: { value: Number(perSeat).toFixed(2), currency: 'RUB' },
      quantity: Number(seats),
      vat_code: vatCode,
      payment_mode: 'full_payment',
      payment_subject: 'service'
    }
  ];
  const receipt = {
    customer: { phone },
    items,
  };
  return receipt;
}

export function initYooCheckout() {
  const { YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY } = process.env;
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    console.warn('YooKassa credentials are not set');
    return null;
  }
  return new YooCheckout({ shopId: YOOKASSA_SHOP_ID, secretKey: YOOKASSA_SECRET_KEY });
}

export async function createCommissionPayment(yc, { amount, description, metadata, idempotenceKey, receipt: receiptInput }) {
  const payload = {
    amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
    confirmation: { type: 'redirect', return_url: metadata?.return_url || 'https://t.me/' },
    capture: true,
    description,
    metadata
  };
  // Добавляем чек, если переданы данные
  if (receiptInput?.phone && receiptInput?.seats && receiptInput?.perSeat) {
    const phone = normalizePhoneForReceipt(receiptInput.phone);
    const receipt = buildPaymentReceipt({
      description,
      phone,
      seats: receiptInput.seats,
      perSeat: receiptInput.perSeat,
      taxSystemCode: receiptInput.taxSystemCode,
    });
    if (receipt) payload.receipt = receipt;
  }
  const payment = await yc.createPayment(payload, idempotenceKey);
  return payment;
}

export function verifyYooSignature(req) {
  const { YOOKASSA_WEBHOOK_SECRET } = process.env;
  if (!YOOKASSA_WEBHOOK_SECRET) return true; // не настроено — пропускаем (лог можно добавить)
  const provided = req.headers['x-yookassa-signature'];
  if (!provided) return false;
  const payload = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', YOOKASSA_WEBHOOK_SECRET).update(payload).digest('hex');
  return hmac === provided;
}

// Создание возврата комиссии (refund)
export async function createRefund(yc, { providerPaymentId, amount, description, idempotenceKey, receipt: receiptInput }) {
  if (!yc || typeof yc.createRefund !== 'function') {
    throw new Error('Refund API not available');
  }
  const payload = {
    payment_id: providerPaymentId,
    amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
    description,
  };
  if (receiptInput?.phone && receiptInput?.seats && receiptInput?.perSeat) {
    const phone = normalizePhoneForReceipt(receiptInput.phone);
    const receipt = buildRefundReceipt({
      description,
      phone,
      seats: receiptInput.seats,
      perSeat: receiptInput.perSeat,
      taxSystemCode: receiptInput.taxSystemCode,
    });
    if (receipt) payload.receipt = receipt;
  }
  const refund = await yc.createRefund(payload, idempotenceKey);
  return refund;
}
