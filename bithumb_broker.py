"""Read-only Bithumb account sync adapter.

This module intentionally has no order, cancel, transfer, or withdrawal
function. It only calls whitelisted GET endpoints for account balances and
filled order history, then normalizes them into the investment ledger shape.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import base64
import hashlib
import hmac
import json
import os
import time
import uuid
from urllib.parse import urlencode

import requests


BITHUMB_BASE_URL = 'https://api.bithumb.com'
READ_ONLY_ENDPOINTS = {
    ('GET', '/v1/accounts'),
    ('GET', '/v1/orders'),
}
FORBIDDEN_ENDPOINT_FRAGMENTS = ('/orders/chance', '/withdraw', '/withdraws', '/deposits/coin_address')


@dataclass
class BithumbConfig:
    api_key: str
    secret_key: str
    base_url: str = BITHUMB_BASE_URL

    @classmethod
    def from_env(cls):
        return cls(
            api_key=os.getenv('BITHUMB_API_KEY', '').strip(),
            secret_key=os.getenv('BITHUMB_SECRET_KEY', '').strip(),
            base_url=os.getenv('BITHUMB_BASE_URL', BITHUMB_BASE_URL).rstrip('/'),
        )

    def missing(self):
        missing = []
        if not self.api_key:
            missing.append('BITHUMB_API_KEY')
        if not self.secret_key:
            missing.append('BITHUMB_SECRET_KEY')
        return missing

    def trading_enabled(self):
        return str(os.getenv('BITHUMB_ENABLE_TRADING') or '').strip().lower() in {'1', 'true', 'yes', 'on'}


def _num(value, default=0.0):
    if value is None or value == '':
        return default
    try:
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return default


def _days_ago(days):
    return (datetime.now(timezone(timedelta(hours=9))) - timedelta(days=days)).strftime('%Y-%m-%d')


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode()


def _jwt(config: BithumbConfig, params: dict | None = None) -> str:
    header = {'alg': 'HS256', 'typ': 'JWT'}
    payload = {
        'access_key': config.api_key,
        'nonce': str(uuid.uuid4()),
        'timestamp': int(time.time() * 1000),
    }
    if params:
        query = urlencode(params, doseq=True)
        payload['query_hash'] = hashlib.sha512(query.encode()).hexdigest()
        payload['query_hash_alg'] = 'SHA512'
    signing_input = f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}.{_b64url(json.dumps(payload, separators=(',', ':')).encode())}"
    signature = hmac.new(config.secret_key.encode(), signing_input.encode(), hashlib.sha256).digest()
    return f'{signing_input}.{_b64url(signature)}'


def _assert_read_only(method: str, path: str):
    clean_method = str(method or '').upper()
    clean_path = str(path or '')
    if any(fragment in clean_path for fragment in FORBIDDEN_ENDPOINT_FRAGMENTS):
        raise RuntimeError(f'Bithumb read-only adapter blocked forbidden endpoint: {clean_method} {clean_path}')
    if (clean_method, clean_path) not in READ_ONLY_ENDPOINTS:
        raise RuntimeError(f'Bithumb read-only adapter blocked non-read-only request: {clean_method} {clean_path}')


def _bithumb_request(config: BithumbConfig, method: str, path: str, params: dict | None = None):
    _assert_read_only(method, path)
    clean_method = str(method or '').upper()
    query = params or {}
    token = _jwt(config, query if query else None)
    res = requests.request(
        clean_method,
        f'{config.base_url}{path}',
        params=query if clean_method == 'GET' else None,
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json; charset=utf-8',
        },
        timeout=12,
    )
    body = res.json() if res.content else {}
    if not res.ok:
        message = ''
        if isinstance(body, dict):
            message = body.get('message') or body.get('error') or ''
        raise RuntimeError(f'Bithumb request failed: {clean_method} {path} HTTP {res.status_code} {message}'.strip())
    return body


def _bithumb_get(config: BithumbConfig, path: str, params: dict | None = None):
    return _bithumb_request(config, 'GET', path, params or {})


def _position_from_account(row):
    currency = str(row.get('currency') or '').strip().upper()
    if not currency:
        return None
    balance = _num(row.get('balance'))
    locked = _num(row.get('locked'))
    quantity = balance + locked
    unit = str(row.get('unit_currency') or 'KRW').strip().upper()
    avg = _num(row.get('avg_buy_price'), 0)
    now = datetime.now(timezone.utc).isoformat()
    if currency == 'KRW':
        return {
            'id': 'bithumb-cash-krw',
            'symbol': 'CASH',
            'name': 'KRW Cash',
            'assetType': 'cash',
            'currency': 'KRW',
            'shares': quantity,
            'cashAmount': quantity,
            'avgPrice': 1,
            'currentPrice': 1,
            'brokerSource': 'bithumb',
            'brokerSyncedAt': now,
        }
    symbol = f'{currency}-{unit}'
    return {
        'id': f'bithumb-{symbol}',
        'symbol': symbol,
        'name': currency,
        'assetType': 'crypto',
        'market': unit,
        'currency': 'KRW',
        'shares': quantity,
        'avgPrice': avg,
        'currentPrice': avg,
        'brokerSource': 'bithumb',
        'brokerSyncedAt': now,
    }


def _decision_from_order(row):
    market = str(row.get('market') or '').strip().upper()
    if not market:
        return None
    side = str(row.get('side') or '').strip().lower()
    action = 'buy' if side == 'bid' else 'sell' if side == 'ask' else ''
    if not action:
        return None
    qty = _num(row.get('executed_volume') or row.get('volume'))
    price = _num(row.get('price') or row.get('avg_price'))
    if qty <= 0 or price <= 0:
        return None
    created = str(row.get('created_at') or datetime.now(timezone.utc).isoformat())
    return {
        'id': f"bithumb-order-{row.get('uuid') or market}-{action}",
        'createdAt': created,
        'date': created[:10],
        'type': 'trade',
        'source': 'bithumb',
        'symbol': market.replace('KRW-', '') + '-KRW' if market.startswith('KRW-') else market,
        'action': action,
        'tradeShares': qty,
        'tradePrice': price,
        'fee': _num(row.get('paid_fee'), 0),
        'title': f"{market} {'매수' if action == 'buy' else '매도'} 체결",
        'summary': f"Bithumb read-only sync: {qty:g} @ {price:g}",
        'verdict': 'synced',
    }


def _merge_by_id(existing, synced):
    by_id = {str(item.get('id')): dict(item) for item in existing or [] if item.get('id')}
    for item in synced:
        by_id[str(item.get('id'))] = item
    return list(by_id.values())


def _merge_positions(existing, synced):
    by_symbol = {}
    for item in existing or []:
        symbol = str(item.get('symbol') or '').upper()
        by_symbol[symbol or str(item.get('id'))] = dict(item)
    for item in synced:
        symbol = str(item.get('symbol') or '').upper()
        prior = by_symbol.get(symbol) or {}
        by_symbol[symbol] = {**prior, **item}
    return list(by_symbol.values())


def sync_bithumb_account(investment: dict, days: int = 30):
    config = BithumbConfig.from_env()
    if config.trading_enabled():
        return {
            'ok': False,
            'configured': True,
            'readOnly': True,
            'error': 'bithumb_trading_mode_forbidden',
            'message': 'Bithumb sync is locked to read-only mode. Disable BITHUMB_ENABLE_TRADING.',
        }
    missing = config.missing()
    if missing:
        return {
            'ok': False,
            'configured': False,
            'readOnly': True,
            'missing': missing,
            'message': 'Bithumb API credentials are not configured',
        }

    account_rows = _bithumb_get(config, '/v1/accounts')
    positions = [p for p in (_position_from_account(row) for row in account_rows or []) if p]
    orders = _bithumb_get(config, '/v1/orders', {
        'state': 'done',
        'limit': 100,
        'order_by': 'desc',
    })
    decisions = [d for d in (_decision_from_order(row) for row in orders or []) if d]

    inv = dict(investment or {})
    inv['positions'] = _merge_positions(inv.get('positions') or [], positions)
    inv['decisions'] = _merge_by_id(inv.get('decisions') or [], decisions)
    inv['events'] = _merge_by_id(inv.get('events') or [], [{
        'id': f'bithumb-sync-{int(time.time())}',
        'date': datetime.now(timezone.utc).date().isoformat(),
        'type': 'broker-sync',
        'severity': 'info',
        'title': 'Bithumb 잔고/체결 기록 읽기 전용 동기화',
        'body': f'잔고 {len(positions)}개, 체결 {len(decisions)}건을 조회했습니다.',
        'source': 'bithumb',
    }])
    old_broker = inv.get('broker') if isinstance(inv.get('broker'), dict) else {}
    inv['broker'] = {
        **old_broker,
        'status': 'connected',
        'provider': 'multi' if old_broker.get('provider') and old_broker.get('provider') != 'bithumb' else 'bithumb',
        'orderIntentOnly': True,
        'readOnly': True,
        'lastSyncedAt': datetime.now(timezone.utc).isoformat(),
        'providers': {
            **(old_broker.get('providers') if isinstance(old_broker.get('providers'), dict) else {}),
            'bithumb': {
                'status': 'connected',
                'readOnly': True,
                'orderIntentOnly': True,
                'lastSyncedAt': datetime.now(timezone.utc).isoformat(),
            },
        },
    }
    return {
        'ok': True,
        'configured': True,
        'readOnly': True,
        'investment': inv,
        'positionsSynced': len(positions),
        'tradesSynced': len(decisions),
    }
