import { createOrderService } from './app.mjs';
import { listen, required } from '../shared/http.mjs';
listen(createOrderService({ internalKey: required('INTERNAL_API_KEY') }), Number(process.env.ORDER_PORT || 3002), process.env.HOST || '127.0.0.1');
