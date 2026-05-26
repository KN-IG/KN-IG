#ifndef IG_TRANSPORT_RUNTIME_H
#define IG_TRANSPORT_RUNTIME_H

#include <stdint.h>
#include <pthread.h>

#include "../realtime/monitor.h"
#include "heartbeat.h"
#include "tcp_client.h"
#include "tls_context.h"

typedef struct {
    const char *server_host;
    uint16_t    server_port;
    const char *ca_crt;
    const char *agent_crt;
    const char *agent_key;
    const char *hostname;
    const char *local_ip;
    const char *os;
    uint8_t     monitor_type;
    int         cert_missing;
} ig_transport_runtime_config_t;

typedef struct {
    ig_tls_ctx_t       tls_ctx;
    ig_tcp_client_t    tcp_client;
    ig_heartbeat_arg_t heartbeat_arg;
    pthread_t          heartbeat_thread;
    char               agent_id[128];
    int                tls_inited;
    int                tcp_inited;
    int                ready;
} ig_transport_runtime_t;

void ig_transport_runtime_init(ig_transport_runtime_t *rt);
void ig_transport_runtime_start(ig_transport_runtime_t *rt,
                                const ig_transport_runtime_config_t *cfg);
void ig_transport_runtime_stop(ig_transport_runtime_t *rt);
int  ig_transport_runtime_send_event(ig_transport_runtime_t *rt,
                                     const ig_event_t *ev);

#endif /* IG_TRANSPORT_RUNTIME_H */
