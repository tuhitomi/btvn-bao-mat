import { createApp, finishApp, internalAuth, requireIdentity } from '../shared/http.mjs';

export const ORDERS = [
  { id: 'order-101', userId: 'user-1', product: 'Bàn phím', quantity: 1, total: 750000, currency: 'VND', status: 'delivered' },
  { id: 'order-102', userId: 'user-1', product: 'Chuột', quantity: 2, total: 500000, currency: 'VND', status: 'processing' },
  { id: 'order-201', userId: 'user-2', product: 'Tai nghe', quantity: 1, total: 900000, currency: 'VND', status: 'pending' },
];

export function createOrderService({ internalKey, logger }) {
  const app = createApp('order-service', { logger });
  app.use(internalAuth(internalKey), requireIdentity);
  app.get('/orders', (req, res) => res.json(ORDERS.filter(order => order.userId === req.userId)));
  return finishApp(app);
}
