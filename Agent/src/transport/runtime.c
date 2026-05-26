#include "runtime.h"

#include <stdio.h>
#include <string.h>

void ig_transport_runtime_init(ig_transport_runtime_t *rt)
{
    if (!rt) return;
    memset(rt, 0, sizeof(*rt));
}

static void cache_register_metadata(ig_tcp_client_t *cli,
                                    const ig_transport_runtime_config_t *cfg)
{
    snprintf(cli->reg_hostname, sizeof(cli->reg_hostname), "%s", cfg->hostname);
    snprintf(cli->reg_ip, sizeof(cli->reg_ip), "%s", cfg->local_ip);
    snprintf(cli->reg_os, sizeof(cli->reg_os), "%s", cfg->os);
    cli->reg_monitor_type = cfg->monitor_type;
    cli->reg_cached = 1;
}

void ig_transport_runtime_start(ig_transport_runtime_t *rt,
                                const ig_transport_runtime_config_t *cfg)
{
    if (!rt || !cfg) return;

    ig_transport_runtime_init(rt);

    LOG_INFO_IG("[transport] 서버: %s:%u", cfg->server_host,
                (unsigned int)cfg->server_port);

    if (cfg->cert_missing) {
        LOG_WARN_IG("[transport] 인증서 없음 — `agent --enroll`을 먼저 실행해야 transport가 활성화됨");
        return;
    }

    if (tls_context_init(&rt->tls_ctx, cfg->ca_crt, cfg->agent_crt,
                         cfg->agent_key) < 0) {
        LOG_WARN_IG("[transport] TLS 컨텍스트 초기화 실패 — transport 비활성화");
        return;
    }
    rt->tls_inited = 1;

    if (ig_tcp_init(&rt->tcp_client, &rt->tls_ctx, cfg->server_host,
                    cfg->server_port) < 0) {
        LOG_WARN_IG("[transport] TCP 클라이언트 초기화 실패");
        return;
    }
    rt->tcp_inited = 1;
    cache_register_metadata(&rt->tcp_client, cfg);

    if (ig_tcp_connect(&rt->tcp_client) < 0) {
        LOG_WARN_IG("[transport] 서버 연결 실패 — 백그라운드 재연결 시도");
        if (ig_tcp_reconnect(&rt->tcp_client) == 0) {
            snprintf(rt->agent_id, sizeof(rt->agent_id), "%llu",
                     (unsigned long long)rt->tcp_client.agent_id);
            LOG_INFO_IG("[transport] 등록 완료 — agent_id: %s", rt->agent_id);
            rt->ready = 1;
        }
    } else if (ig_tcp_register(&rt->tcp_client, cfg->hostname, cfg->local_ip,
                               cfg->monitor_type, cfg->os, rt->agent_id,
                               sizeof(rt->agent_id)) == 0) {
        LOG_INFO_IG("[transport] 등록 완료 — agent_id: %s", rt->agent_id);
        rt->ready = 1;
    } else {
        LOG_WARN_IG("[transport] REGISTER 실패");
    }

    if (rt->ready) {
        rt->heartbeat_arg.cli = &rt->tcp_client;
        rt->heartbeat_arg.interval_sec = IG_HEARTBEAT_DEFAULT_SEC;
        rt->heartbeat_arg.running = 1;
        if (pthread_create(&rt->heartbeat_thread, NULL, ig_heartbeat_thread,
                           &rt->heartbeat_arg) != 0) {
            rt->heartbeat_arg.running = 0;
            LOG_WARN_IG("[transport] heartbeat 스레드 생성 실패");
        } else {
            LOG_INFO_IG("[transport] heartbeat 스레드 시작 완료");
        }
    }

    return;
}

void ig_transport_runtime_stop(ig_transport_runtime_t *rt)
{
    if (!rt) return;

    if (rt->heartbeat_arg.running) rt->heartbeat_arg.running = 0;
    if (rt->heartbeat_thread) {
        pthread_join(rt->heartbeat_thread, NULL);
        LOG_INFO_IG("heartbeat 스레드 합류");
        rt->heartbeat_thread = 0;
    }

    if (rt->tcp_inited) {
        ig_tcp_disconnect(&rt->tcp_client);
        ig_tcp_free(&rt->tcp_client);
        rt->tcp_inited = 0;
    }
    if (rt->tls_inited) {
        tls_context_free(&rt->tls_ctx);
        rt->tls_inited = 0;
        LOG_INFO_IG("[transport] 연결 종료");
    }

    rt->ready = 0;
    rt->agent_id[0] = '\0';
}

int ig_transport_runtime_send_event(ig_transport_runtime_t *rt,
                                    const ig_event_t *ev)
{
    if (!rt || !ev || !rt->ready || !rt->agent_id[0]) return 0;

    int ret = ig_tcp_send_event(&rt->tcp_client, ev);
    if (ret == -2) {
        LOG_WARN_IG("[transport] FILE_EVENT 전송 실패 — 재연결 시도");
        rt->ready = 0;
        if (ig_tcp_reconnect(&rt->tcp_client) == 0) {
            snprintf(rt->agent_id, sizeof(rt->agent_id), "%llu",
                     (unsigned long long)rt->tcp_client.agent_id);
            rt->ready = 1;
            return ig_tcp_send_event(&rt->tcp_client, ev);
        }
        return ret;
    }

    if (ret < 0) {
        LOG_WARN_IG("[transport] FILE_EVENT 전송 실패 (재시도 예정)");
    }
    return ret;
}
