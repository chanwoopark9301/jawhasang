import time


def normalize_position(raw, symbol_re):
    position = dict(raw or {})
    asset_type = str(position.get('assetType') or 'stock').strip().lower()
    if asset_type not in {'stock', 'crypto', 'cash'}:
        asset_type = 'stock'
    position['assetType'] = asset_type
    symbol = str(position.get('symbol', '')).strip().upper()
    if asset_type == 'cash' and not symbol:
        symbol = 'CASH'
    if not symbol_re.match(symbol):
        raise ValueError('유효하지 않은 종목 코드입니다')
    position['symbol'] = symbol
    if asset_type == 'cash':
        position.setdefault('name', '현금')
        position['manualPrice'] = True
        position['currency'] = position.get('currency') or 'USD'
        if position.get('cashAmount') in (None, ''):
            position['cashAmount'] = position.get('shares') or 0
    position.setdefault('id', f'ip{int(time.time() * 1000)}')

    numeric_fields = [
        'shares', 'avgPrice', 'currentPrice', 'targetPrice',
        'stopPrice', 'previousClose', 'changePercent', 'cashAmount',
    ]
    nullable_fields = {'currentPrice', 'previousClose', 'changePercent'}
    for field in numeric_fields:
        if position.get(field) in (None, ''):
            position[field] = None if field in nullable_fields else 0
            continue
        try:
            position[field] = float(str(position[field]).replace(',', '').strip())
        except (TypeError, ValueError):
            position[field] = None if field in nullable_fields else 0
    if asset_type == 'cash':
        cash_amount = position.get('cashAmount')
        if cash_amount in (None, ''):
            cash_amount = position.get('shares') or 0
        position['cashAmount'] = float(cash_amount or 0)
        position['shares'] = position['cashAmount']
        position['avgPrice'] = 1.0
        position['currentPrice'] = 1.0
    return position


def upsert_position(data, raw_position, normalize_data, symbol_re):
    normalized_data = normalize_data(data)
    inv = normalized_data['investment']
    position = normalize_position(raw_position, symbol_re)
    positions = inv.get('positions', [])

    replaced = False
    for idx, item in enumerate(positions):
        same_id = str(item.get('id')) == str(position.get('id'))
        same_symbol = str(item.get('symbol', '')).upper() == position['symbol']
        if same_id or same_symbol:
            positions[idx] = {**item, **position}
            replaced = True
            break

    if not replaced:
        positions.append(position)

    inv['positions'] = positions
    normalized_data['investment'] = inv
    return normalized_data, inv, position
