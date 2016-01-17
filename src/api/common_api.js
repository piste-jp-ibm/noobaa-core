'use strict';

/**
 *
 * COMMON API
 *
 * general defenitions used by other api's
 *
 */
module.exports = {

    name: 'common_api',

    methods: {},

    definitions: {

        storage_info: {
            type: 'object',
            // required: [],
            properties: {
                total: {
                    $ref: '/common_api/definitions/bigint'
                },
                free: {
                    $ref: '/common_api/definitions/bigint'
                },
                used: {
                    $ref: '/common_api/definitions/bigint'
                },
                alloc: {
                    $ref: '/common_api/definitions/bigint'
                },
                limit: {
                    $ref: '/common_api/definitions/bigint'
                },
                // real - after calculating dedup reduction or redundancy overheads
                real: {
                    $ref: '/common_api/definitions/bigint'
                },
            }
        },

        drive_info: {
            type: 'object',
            // required: [],
            properties: {
                mount: {
                    type: 'string'
                },
                drive_id: {
                    type: 'string'
                },
                storage: {
                    $ref: '/common_api/definitions/storage_info'
                },
            }
        },

        os_info: {
            type: 'object',
            // required: [],
            properties: {
                hostname: {
                    type: 'string'
                },
                ostype: {
                    type: 'string'
                },
                platform: {
                    type: 'string'
                },
                arch: {
                    type: 'string'
                },
                release: {
                    type: 'string'
                },
                uptime: {
                    type: 'integer',
                    format: 'idate',
                },
                loadavg: {
                    type: 'array',
                    items: {
                        type: 'number'
                    }
                },
                totalmem: {
                    type: 'integer'
                },
                freemem: {
                    type: 'integer'
                },
                cpus: {
                    type: 'array',
                    items: {
                        type: 'object',
                        additionalProperties: true,
                        properties: {}
                    }
                },
                networkInterfaces: {
                    type: 'object',
                    additionalProperties: true,
                    properties: {}
                }
            }
        },


        bigint: {
            oneOf: [{
                type: 'integer'
            }, {
                type: 'object',
                properties: {
                    n: {
                        type: 'integer',
                    },
                    // to support bigger integers we can specify a peta field
                    // which is considered to be based from 2^50
                    peta: {
                        type: 'integer',
                    }
                }
            }]
        },

        n2n_config: {
            type: 'object',
            // required: [],
            properties: {
                // ip options
                offer_ipv4: {
                    type: 'boolean'
                },
                offer_ipv6: {
                    type: 'boolean'
                },
                accept_ipv4: {
                    type: 'boolean'
                },
                accept_ipv6: {
                    type: 'boolean'
                },
                offer_internal: {
                    type: 'boolean'
                },

                // tcp options
                tcp_active: {
                    type: 'boolean'
                },
                tcp_permanent_passive: {
                    $ref: '/common_api/definitions/port_range_config'
                },
                tcp_transient_passive: {
                    $ref: '/common_api/definitions/port_range_config'
                },
                tcp_simultaneous_open: {
                    $ref: '/common_api/definitions/port_range_config'
                },
                tcp_tls: {
                    type: 'boolean'
                },

                // udp options
                udp_port: {
                    type: 'boolean'
                },
                udp_dtls: {
                    type: 'boolean'
                },
                stun_servers: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                }
            }
        },

        // false means disable the port.
        // true means random port.
        // object with port means single port.
        // object with min-max means port range.
        port_range_config: {
            oneOf: [{
                type: 'boolean'
            }, {
                type: 'object',
                required: ['port'],
                properties: {
                    port: {
                        type: 'integer'
                    }
                }
            }, {
                type: 'object',
                required: ['min', 'max'],
                properties: {
                    min: {
                        type: 'integer'
                    },
                    max: {
                        type: 'integer'
                    }
                }
            }]
        }


    }
};
