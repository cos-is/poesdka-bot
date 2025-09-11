import { YooCheckout } from '@a2seven/yoo-checkout';
import crypto from 'crypto'
import { config } from 'dotenv';
config();

export function initYooCheckout() {
  const { YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY } = process.env;
  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    console.warn('YooKassa credentials are not set');
    return null;
  }
  return new YooCheckout({ shopId: YOOKASSA_SHOP_ID, secretKey: YOOKASSA_SECRET_KEY });
}

export async function createCommissionPayment(yc, { amount, description, metadata, idempotenceKey }) {
  const payment = await yc.createPayment({
    amount: { value: amount.toFixed(2), currency: 'RUB' },
    confirmation: { type: 'redirect', return_url: metadata?.return_url || 'https://t.me/' },
    capture: true,
    description,
    metadata
  }, idempotenceKey);
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
export async function createRefund(yc, { providerPaymentId, amount, description, idempotenceKey }) {
  if (!yc || typeof yc.createRefund !== 'function') {
    throw new Error('Refund API not available');
  }
  const refund = await yc.createRefund({
    payment_id: providerPaymentId,
    amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
    description,
  }, idempotenceKey);
  return refund;
}
