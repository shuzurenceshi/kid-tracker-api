/**
 * Kid Tracker API - 位置数据存储服务
 * 使用 Cloudflare KV 存储
 */

const ALLOWED_ORIGINS = [
  'https://kid-tracker.pages.dev',
  'https://e87ccfef.kid-tracker.pages.dev',
  'http://localhost:5500'
];

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const headers = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

    try {
      // ========== 上报位置 ==========
      if (path === '/api/location' && request.method === 'POST') {
        const body = await request.json();
        const { device_id, latitude, longitude, accuracy, battery, timestamp } = body;

        if (!device_id || !latitude || !longitude) {
          return new Response(JSON.stringify({ error: '缺少参数' }), { status: 400, headers });
        }

        const data = { device_id, latitude, longitude, accuracy, battery, timestamp: timestamp || Date.now() };
        
        // 保存最新位置
        await env.KV.put(`loc:${device_id}:latest`, JSON.stringify(data), { expirationTtl: 86400 * 7 });
        
        // 保存历史（追加到列表）
        const historyKey = `loc:${device_id}:history`;
        let history = [];
        try {
          history = JSON.parse(await env.KV.get(historyKey) || '[]');
        } catch (e) {}
        history.push(data);
        // 保留最近1000条（约3小时，每10秒一条）
        if (history.length > 1000) history = history.slice(-1000);
        await env.KV.put(historyKey, JSON.stringify(history), { expirationTtl: 86400 * 3 });

        return new Response(JSON.stringify({ success: true }), { headers });
      }

      // ========== 获取最新位置 ==========
      if (path === '/api/location/latest' && request.method === 'GET') {
        const device_id = url.searchParams.get('device_id') || 'kid-1';
        const data = await env.KV.get(`loc:${device_id}:latest`);
        return new Response(data || '{}', { headers });
      }

      // ========== 获取历史轨迹 ==========
      if (path === '/api/location/history' && request.method === 'GET') {
        const device_id = url.searchParams.get('device_id') || 'kid-1';
        const hours = parseInt(url.searchParams.get('hours') || '24');
        
        const historyStr = await env.KV.get(`loc:${device_id}:history`);
        let history = JSON.parse(historyStr || '[]');
        
        // 过滤时间范围
        const cutoff = Date.now() - hours * 3600 * 1000;
        history = history.filter(p => p.timestamp > cutoff);
        
        return new Response(JSON.stringify(history), { headers });
      }

      return new Response('Not Found', { status: 404, headers });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
    }
  }
};
