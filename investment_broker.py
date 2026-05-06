"""Broker/order integration preparation for the investment partner.

This module intentionally does not place real orders. It creates a normalized
order intent that can later be handed to a broker adapter after explicit user
approval and broker-specific authentication are added.
"""

from dataclasses import dataclass, asdict
from datetime import datetime, timezone


SUPPORTED_ACTIONS = {'buy', 'add', 'sell', 'hold'}
SUPPORTED_ORDER_TYPES = {'market', 'limit', 'stop'}


@dataclass
class OrderIntent:
    id: str
    createdAt: str
    symbol: str
    action: str
    quantity: float
    orderType: str
    limitPrice: float
    source: str
    status: str
    reason: str

    def to_dict(self):
        return asdict(self)


def _num(value, default=0.0):
    if value is None or value == '':
        return default
    if isinstance(value, str):
        value = value.replace(',', '').strip()
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def build_order_intent(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError('order intent payload must be an object')

    symbol = str(payload.get('symbol') or '').strip().upper()
    if not symbol:
        raise ValueError('symbol is required')

    action = str(payload.get('action') or 'buy').strip().lower()
    if action not in SUPPORTED_ACTIONS:
        raise ValueError(f'unsupported action: {action}')

    order_type = str(payload.get('orderType') or 'limit').strip().lower()
    if order_type not in SUPPORTED_ORDER_TYPES:
        raise ValueError(f'unsupported order type: {order_type}')

    quantity = _num(payload.get('quantity') or payload.get('shares'))
    if action != 'hold' and quantity <= 0:
        raise ValueError('quantity must be greater than 0')

    limit_price = _num(payload.get('limitPrice') or payload.get('price'))
    if order_type in {'limit', 'stop'} and limit_price <= 0:
        raise ValueError('price is required for limit/stop orders')

    now = datetime.now(timezone.utc).isoformat()
    intent = OrderIntent(
        id=f"oi-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        createdAt=now,
        symbol=symbol,
        action=action,
        quantity=quantity,
        orderType=order_type,
        limitPrice=limit_price,
        source=str(payload.get('source') or 'investment-partner'),
        status='draft',
        reason=str(payload.get('reason') or '').strip(),
    )
    return intent.to_dict()
