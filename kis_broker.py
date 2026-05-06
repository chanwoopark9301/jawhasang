"""Read-only Korea Investment Securities (KIS) account sync adapter.

The adapter deliberately does not place orders. It only reads balances and
filled trade history, then returns normalized investment data that the app can
merge into its portfolio/timeline.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import os
import time

import requests


KIS_BASE_URL = 'https://openapi.koreainvestment.com:9443'
DOMESTIC_BALANCE_TR = 'TTTC8434R'
DOMESTIC_DAILY_CCLD_TR = 'TTTC8001R'
OVERSEAS_BALANCE_TR = 'TTTS3012R'
OVERSEAS_EXCHANGES = ('NASD', 'NYSE', 'AMEX')


@dataclass
class KisConfig:
    app_key: str
    app_secret: str
    account: str
    product_code: str
    base_url: str = KIS_BASE_URL

    @classmethod
    def from_env(cls):
        return cls(
            app_key=os.getenv('KIS_APP_KEY', '').strip(),
            app_secret=os.getenv('KIS_APP_SECRET', '').strip(),
            account=os.getenv('KIS_CANO', '').strip(),
            product_code=os.getenv('KIS_ACNT_PRDT_CD', '01').strip() or '01',
            base_url=os.getenv('KIS_BASE_URL', KIS_BASE_URL).rstrip('/'),
        )

    def missing(self):
        missing = []
        if not self.app_key:
            missing.append('KIS_APP_KEY')
        if not self.app_secret:
            missing.append('KIS_APP_SECRET')
        if not self.account:
            missing.append('KIS_CANO')
        if not self.product_code:
            missing.append('KIS_ACNT_PRDT_CD')
        return missing


def _num(value, default=0.0):
    if value is None or value == '':
        return default
    try:
        return float(str(value).replace(',', '').strip())
    except (TypeError, ValueError):
        return default


def _today_kr():
    return datetime.now(timezone(timedelta(hours=9))).strftime('%Y%m%d')


def _days_ago_kr(days):
    return (datetime.now(timezone(timedelta(hours=9))) - timedelta(days=days)).strftime('%Y%m%d')


def _token(config: KisConfig):
    res = requests.post(
        f'{config.base_url}/oauth2/tokenP',
        json={
            'grant_type': 'client_credentials',
            'appkey': config.app_key,
            'appsecret': config.app_secret,
        },
        timeout=10,
    )
    body = res.json() if res.content else {}
    if not res.ok or not body.get('access_token'):
        raise RuntimeError(f"KIS token failed: HTTP {res.status_code} {body.get('msg1') or body.get('error_description') or ''}".strip())
    return body['access_token']


def _kis_get(config: KisConfig, access_token: str, path: str, tr_id: str, params: dict):
    res = requests.get(
        f'{config.base_url}{path}',
        params=params,
        headers={
            'authorization': f'Bearer {access_token}',
            'appkey': config.app_key,
            'appsecret': config.app_secret,
            'tr_id': tr_id,
            'custtype': 'P',
            'Content-Type': 'application/json; charset=utf-8',
        },
        timeout=12,
    )
    body = res.json() if res.content else {}
    if not res.ok or str(body.get('rt_cd', '0')) not in ('0', ''):
        raise RuntimeError(f"KIS request failed: {tr_id} HTTP {res.status_code} {body.get('msg1') or body.get('error') or ''}".strip())
    return body


def _position_from_domestic(row):
    symbol = str(row.get('pdno') or row.get('PDNO') or '').strip()
    if not symbol:
        return None
    shares = _num(row.get('hldg_qty') or row.get('HLDG_QTY'))
    avg_price = _num(row.get('pchs_avg_pric') or row.get('PCHS_AVG_PRIC'))
    current = _num(row.get('prpr') or row.get('PRPR') or row.get('bass_pric'))
    value = _num(row.get('evlu_amt') or row.get('EVLU_AMT'))
    return {
        'id': f'kis-kr-{symbol}',
        'symbol': symbol,
        'name': str(row.get('prdt_name') or row.get('PRDT_NAME') or symbol).strip(),
        'assetType': 'stock',
        'market': 'KR',
        'currency': 'KRW',
        'shares': shares,
        'avgPrice': avg_price,
        'currentPrice': current,
        'brokerValue': value,
        'brokerSource': 'kis',
        'brokerSyncedAt': datetime.now(timezone.utc).isoformat(),
    }


def _position_from_overseas(row, exchange):
    symbol = str(row.get('ovrs_pdno') or row.get('OVRS_PDNO') or row.get('pdno') or '').strip().upper()
    if not symbol:
        return None
    shares = _num(row.get('ovrs_cblc_qty') or row.get('frcr_evlu_pfls_amt') or row.get('hldg_qty'))
    avg_price = _num(row.get('pchs_avg_pric') or row.get('avg_unpr3'))
    current = _num(row.get('now_pric') or row.get('ovrs_now_pric'))
    value = _num(row.get('ovrs_stck_evlu_amt') or row.get('frcr_evlu_amt2'))
    return {
        'id': f'kis-us-{symbol}',
        'symbol': symbol,
        'name': str(row.get('ovrs_item_name') or row.get('prdt_name') or symbol).strip(),
        'assetType': 'stock',
        'market': exchange,
        'currency': 'USD',
        'shares': shares,
        'avgPrice': avg_price,
        'currentPrice': current,
        'brokerValue': value,
        'brokerSource': 'kis',
        'brokerSyncedAt': datetime.now(timezone.utc).isoformat(),
    }


def _trade_from_domestic(row):
    symbol = str(row.get('pdno') or '').strip()
    if not symbol:
        return None
    side_text = str(row.get('sll_buy_dvsn_cd_name') or row.get('sll_buy_dvsn_cd') or '').strip()
    action = 'sell' if '매도' in side_text or side_text == '01' else 'buy'
    date = str(row.get('ord_dt') or row.get('trd_dt') or _today_kr())
    qty = _num(row.get('tot_ccld_qty') or row.get('ccld_qty') or row.get('ord_qty'))
    price = _num(row.get('avg_prvs') or row.get('avg_pric') or row.get('ord_unpr'))
    return {
        'id': f"kis-trade-{date}-{row.get('odno') or symbol}-{action}",
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'date': f'{date[:4]}-{date[4:6]}-{date[6:8]}' if len(date) == 8 else date,
        'type': 'trade',
        'source': 'kis',
        'symbol': symbol,
        'action': action,
        'tradeShares': qty,
        'tradePrice': price,
        'title': f"{symbol} {'매도' if action == 'sell' else '매수'} 체결",
        'summary': f"KIS 체결 동기화: {qty:g}주 @ {price:g}",
        'verdict': 'synced',
    }


def _merge_positions(existing, synced):
    by_key = {}
    for item in existing or []:
        symbol = str(item.get('symbol') or '').upper()
        key = str(item.get('id') or symbol)
        by_key[key] = dict(item)
        if symbol:
            by_key.setdefault(symbol, by_key[key])
    for item in synced:
        symbol = str(item.get('symbol') or '').upper()
        key = str(item.get('id') or symbol)
        prior = by_key.get(symbol) or by_key.get(key) or {}
        merged = {**prior, **item}
        by_key[key] = merged
        if symbol:
            by_key[symbol] = merged
    unique = []
    seen = set()
    for item in by_key.values():
        item_id = str(item.get('id') or item.get('symbol') or '')
        if item_id in seen:
            continue
        seen.add(item_id)
        unique.append(item)
    return unique


def _merge_decisions(existing, synced):
    by_id = {str(item.get('id')): item for item in existing or [] if item.get('id')}
    for item in synced:
        by_id[str(item.get('id'))] = item
    return list(by_id.values())


def sync_kis_account(investment: dict, days: int = 30):
    config = KisConfig.from_env()
    missing = config.missing()
    if missing:
        return {
            'ok': False,
            'configured': False,
            'missing': missing,
            'message': 'KIS API credentials are not configured',
        }

    access_token = _token(config)
    positions = []
    decisions = []

    domestic_balance = _kis_get(
        config,
        access_token,
        '/uapi/domestic-stock/v1/trading/inquire-balance',
        DOMESTIC_BALANCE_TR,
        {
            'CANO': config.account,
            'ACNT_PRDT_CD': config.product_code,
            'AFHR_FLPR_YN': 'N',
            'OFL_YN': '',
            'INQR_DVSN': '02',
            'UNPR_DVSN': '01',
            'FUND_STTL_ICLD_YN': 'N',
            'FNCG_AMT_AUTO_RDPT_YN': 'N',
            'PRCS_DVSN': '01',
            'CTX_AREA_FK100': '',
            'CTX_AREA_NK100': '',
        },
    )
    for row in domestic_balance.get('output1') or []:
        pos = _position_from_domestic(row)
        if pos:
            positions.append(pos)

    for exchange in OVERSEAS_EXCHANGES:
        try:
            overseas_balance = _kis_get(
                config,
                access_token,
                '/uapi/overseas-stock/v1/trading/inquire-balance',
                OVERSEAS_BALANCE_TR,
                {
                    'CANO': config.account,
                    'ACNT_PRDT_CD': config.product_code,
                    'OVRS_EXCG_CD': exchange,
                    'TR_CRCY_CD': 'USD',
                    'CTX_AREA_FK200': '',
                    'CTX_AREA_NK200': '',
                },
            )
            for row in overseas_balance.get('output1') or []:
                pos = _position_from_overseas(row, exchange)
                if pos:
                    positions.append(pos)
        except RuntimeError:
            continue

    domestic_trades = _kis_get(
        config,
        access_token,
        '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
        DOMESTIC_DAILY_CCLD_TR,
        {
            'CANO': config.account,
            'ACNT_PRDT_CD': config.product_code,
            'INQR_STRT_DT': _days_ago_kr(max(1, min(int(days or 30), 90))),
            'INQR_END_DT': _today_kr(),
            'SLL_BUY_DVSN_CD': '00',
            'INQR_DVSN': '00',
            'PDNO': '',
            'CCLD_DVSN': '01',
            'ORD_GNO_BRNO': '',
            'ODNO': '',
            'INQR_DVSN_3': '00',
            'INQR_DVSN_1': '',
            'CTX_AREA_FK100': '',
            'CTX_AREA_NK100': '',
        },
    )
    for row in domestic_trades.get('output1') or []:
        trade = _trade_from_domestic(row)
        if trade:
            decisions.append(trade)

    inv = dict(investment or {})
    inv['positions'] = _merge_positions(inv.get('positions') or [], positions)
    inv['decisions'] = _merge_decisions(inv.get('decisions') or [], decisions)
    inv['events'] = _merge_decisions(inv.get('events') or [], [
        {
            'id': f'kis-sync-{int(time.time())}',
            'date': datetime.now(timezone.utc).date().isoformat(),
            'type': 'broker-sync',
            'severity': 'info',
            'title': 'KIS 잔고/매매 기록 동기화',
            'body': f'잔고 {len(positions)}개, 체결 {len(decisions)}건을 조회했습니다.',
            'source': 'kis',
        }
    ])
    inv['broker'] = {
        **(inv.get('broker') if isinstance(inv.get('broker'), dict) else {}),
        'status': 'connected',
        'provider': 'kis',
        'orderIntentOnly': True,
        'lastSyncedAt': datetime.now(timezone.utc).isoformat(),
    }
    return {
        'ok': True,
        'configured': True,
        'investment': inv,
        'positionsSynced': len(positions),
        'tradesSynced': len(decisions),
    }
