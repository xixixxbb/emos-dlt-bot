/**
 * /start payload 路由（计划书 §5.2）
 * emos 回跳格式：[支付状态]-[订单号]-[其他参数]-[TgId]
 * 注意：emos 订单号本身可能含 "-"（如 20260215153614-pay-eA2rq），
 *       因此取末段为 TgId、倒数第二段为 param、其余合并为订单号。
 */
export function parseDeeplink(payload) {
  if (!payload) return null
  for (const [prefix, type] of [
    ['emosPayAgree-', 'pay_agree'],
    ['emosPayRefuse-', 'pay_refuse'],
  ]) {
    if (payload.startsWith(prefix)) {
      const segs = payload.slice(prefix.length).split('-').filter((s) => s !== undefined)
      const tgid = segs.length >= 2 ? segs[segs.length - 1] : ''
      const param = segs.length >= 3 ? segs[segs.length - 2] : ''
      const no = segs.length >= 3 ? segs.slice(0, segs.length - 2).join('-') : segs.join('-')
      return { type, no, param: param || '', tgid: tgid || '' }
    }
  }
  if (payload.startsWith('emosLinkAgree-')) {
    return { type: 'link_agree', token: payload.slice('emosLinkAgree-'.length) }
  }
  if (payload.startsWith('emosLinkRefuse')) {
    return { type: 'link_refuse' }
  }
  return null
}
