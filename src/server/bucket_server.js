/* jshint node:true */
'use strict';

/**
 *
 * BUCKET_SERVER
 *
 */

module.exports = {
    new_bucket_defaults: new_bucket_defaults,
    get_bucket_info: get_bucket_info,

    //Bucket Management
    create_bucket: create_bucket,
    read_bucket: read_bucket,
    update_bucket: update_bucket,
    delete_bucket: delete_bucket,
    list_buckets: list_buckets,

    //Cloud Sync policies
    get_cloud_sync_policy: get_cloud_sync_policy,
    get_all_cloud_sync_policies: get_all_cloud_sync_policies,
    delete_cloud_sync: delete_cloud_sync,
    set_cloud_sync: set_cloud_sync,

    //Temporary - TODO: move to new server
    get_cloud_buckets: get_cloud_buckets
};

var _ = require('lodash');
var AWS = require('aws-sdk');
var db = require('./db');
var object_server = require('./object_server');
var tier_server = require('./tier_server');
var bg_worker = require('./server_rpc').bg_worker;
var system_store = require('./stores/system_store');
var cs_utils = require('./utils/cloud_sync_utils');
var size_utils = require('../util/size_utils');
var mongo_utils = require('../util/mongo_utils');
var dbg = require('../util/debug_module')(__filename);
var P = require('../util/promise');


function new_bucket_defaults(name, system_id, tiering) {
    return {
        name: name,
        system: system_id,
        tiering: tiering,
        stats: {
            reads: 0,
            writes: 0,
        }
    };
}


/**
 *
 * CREATE_BUCKET
 *
 */
function create_bucket(req) {
    var bucket = new_bucket_defaults(
        req.rpc_params.name,
        req.system._id,
        resolve_tiering(req, req.rpc_params.tiering));
    db.ActivityLog.create({
        event: 'bucket.create',
        level: 'info',
        system: req.system._id,
        actor: req.account._id,
        bucket: bucket._id,
    });
    return system_store.make_changes({
        insert: {
            buckets: [bucket]
        }
    }).then(function() {
        var created_bucket = find_bucket(req);
        return get_bucket_info(created_bucket);
    });
}

/**
 *
 * READ_BUCKET
 *
 */
function read_bucket(req) {
    var bucket = find_bucket(req);
    var pools = _.flatten(_.map(bucket.tiering, level => level.tier.pools));
    var pool_ids = mongo_utils.uniq_ids(pools, '_id');
    return P.join(
        // objects - size, count
        db.ObjectMD.aggregate_objects({
            system: req.system._id,
            bucket: bucket._id,
            deleted: null,
        }),
        db.Node.aggregate_nodes({
            system: req.system._id,
            pool: {
                $in: pool_ids
            },
            deleted: null,
        }, 'pool'),
        get_cloud_sync_policy(req, bucket)
    ).spread(function(objects_aggregate, nodes_aggregate_pool, cloud_sync_policy) {
        return get_bucket_info(bucket, objects_aggregate, nodes_aggregate_pool, cloud_sync_policy);
    });
}



/**
 *
 * UPDATE_BUCKET
 *
 */
function update_bucket(req) {
    var bucket = find_bucket(req);
    var updates = {
        _id: bucket._id
    };
    if (req.rpc_params.new_name) {
        updates.name = req.rpc_params.new_name;
    }
    if (req.rpc_params.tiering) {
        updates.tiering = resolve_tiering(req, req.rpc_params.tiering);
    }
    return system_store.make_changes({
        update: {
            buckets: [updates]
        }
    }).return();
}



/**
 *
 * DELETE_BUCKET
 *
 */
function delete_bucket(req) {
    var bucket = find_bucket(req);
    db.ActivityLog.create({
        event: 'bucket.delete',
        level: 'info',
        system: req.system._id,
        actor: req.account._id,
        bucket: bucket._id,
    });
    return system_store.make_changes({
            remove: {
                buckets: [bucket._id]
            }
        })
        .then(function() {
            return P.when(bg_worker.cloud_sync.refresh_policy({
                sysid: req.system._id,
                bucketid: bucket._id.toString(),
                force_stop: true,
            }));
        })
        .return();
}



/**
 *
 * LIST_BUCKETS
 *
 */
function list_buckets(req) {
    return {
        buckets: _.map(req.system.buckets_by_name, function(bucket) {
            return _.pick(bucket, 'name');
        })
    };
}

/**
 *
 * GET_CLOUD_SYNC_POLICY
 *
 */
function get_cloud_sync_policy(req, bucket) {
    dbg.log3('get_cloud_sync_policy');
    bucket = bucket || find_bucket(req);
    if (!bucket.cloud_sync || !bucket.cloud_sync.endpoint) {
        return {};
    }
    return P.when(bg_worker.cloud_sync.get_policy_status({
            sysid: bucket.system._id,
            bucketid: bucket._id
        }))
        .then(function(stat) {
            return {
                name: bucket.name,
                policy: {
                    endpoint: bucket.cloud_sync.endpoint,
                    access_keys: [bucket.cloud_sync.access_keys],
                    schedule: bucket.cloud_sync.schedule_min,
                    last_sync: bucket.cloud_sync.last_sync.getTime(),
                    paused: bucket.cloud_sync.paused,
                    c2n_enabled: bucket.cloud_sync.c2n_enabled,
                    n2c_enabled: bucket.cloud_sync.n2c_enabled,
                    additions_only: bucket.cloud_sync.additions_only
                },
                health: stat.health,
                status: stat.status,
            };
        });
}

/**
 *
 * GET_ALL_CLOUD_SYNC_POLICIES
 *
 */
function get_all_cloud_sync_policies(req) {
    dbg.log3('get_all_cloud_sync_policies');
    var reply = [];
    return P.all(_.map(req.system.buckets_by_name, function(bucket) {
        if (!bucket.cloud_sync.endpoint) return;
        return bg_worker.cloud_sync.get_policy_status({
                sysid: req.system._id,
                bucketid: bucket._id
            })
            .then(function(stat) {
                reply.push({
                    name: bucket.name,
                    health: stat.health,
                    status: stat.status,
                    policy: {
                        endpoint: bucket.cloud_sync.endpoint,
                        access_keys: [bucket.cloud_sync.access_keys],
                        schedule: bucket.cloud_sync.schedule_min,
                        last_sync: bucket.cloud_sync.last_sync.getTime(),
                        paused: bucket.cloud_sync.paused,
                        c2n_enabled: bucket.cloud_sync.c2n_enabled,
                        n2c_enabled: bucket.cloud_sync.n2c_enabled,
                        additions_only: bucket.cloud_sync.additions_only
                    }
                });
            });
    })).return(reply);
}

/**
 *
 * DELETE_CLOUD_SYNC
 *
 */
function delete_cloud_sync(req) {
    dbg.log2('delete_cloud_sync:', req.rpc_params.name, 'on', req.system._id);
    var bucket = find_bucket(req);
    dbg.log3('delete_cloud_sync: delete on bucket', bucket);
    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    cloud_sync: {}
                }]
            }
        })
        .then(function() {
            return bg_worker.cloud_sync.refresh_policy({
                sysid: req.system._id,
                bucketid: bucket._id,
                force_stop: true,
            });
        })
        .return();
}

/**
 *
 * SET_CLOUD_SYNC
 *
 */
function set_cloud_sync(req) {
    dbg.log0('set_cloud_sync:', req.rpc_params.name, 'on', req.system._id, 'with', req.rpc_params.policy);
    var bucket = find_bucket(req);
    var force_stop = false;
    //Verify parameters, bi-directional sync can't be set with additions_only
    if (req.rpc_params.policy.additions_only &&
        req.rpc_params.policy.n2c_enabled &&
        req.rpc_params.policy.c2n_enabled) {
        dbg.warn('set_cloud_sync bi-directional sync cant be set with additions_only');
        throw new Error('bi-directional sync cant be set with additions_only');
    }
    var cloud_sync = {
        endpoint: req.rpc_params.policy.endpoint,
        access_keys: {
            access_key: req.rpc_params.policy.access_keys[0].access_key,
            secret_key: req.rpc_params.policy.access_keys[0].secret_key
        },
        schedule_min: req.rpc_params.policy.schedule,
        last_sync: 0,
        paused: req.rpc_params.policy.paused,
        c2n_enabled: req.rpc_params.policy.c2n_enabled,
        n2c_enabled: req.rpc_params.policy.n2c_enabled,
        additions_only: req.rpc_params.policy.additions_only
    };

    //If either of the following is changed, signal the cloud sync worker to force stop and reload
    if (bucket.cloud_sync.endpoint !== cloud_sync.endpoint ||
        bucket.cloud_sync.access_keys.access_key !== cloud_sync.access_keys.access_key ||
        bucket.cloud_sync.access_keys.secret_key !== cloud_sync.access_keys.secret_key ||
        cloud_sync.paused) {
        force_stop = true;
    }
    return system_store.make_changes({
            update: {
                buckets: [{
                    _id: bucket._id,
                    cloud_sync: cloud_sync
                }]
            }
        })
        .then(function() {
            //TODO:: scale, fine for 1000 objects, not for 1M
            return object_server.set_all_files_for_sync(req.system._id, bucket._id);
        })
        .then(function() {
            return bg_worker.cloud_sync.refresh_policy({
                sysid: req.system._id,
                bucketid: bucket._id,
                force_stop: force_stop,
            });
        })
        .catch(function(err) {
            dbg.error('Error setting cloud sync', err, err.stack);
            throw err;
        })
        .return();
}

/**
 *
 * GET_CLOUD_BUCKETS
 *
 */
function get_cloud_buckets(req) {
    var buckets = [];
    return P.fcall(function() {
        var s3 = new AWS.S3({
            accessKeyId: req.rpc_params.access_key,
            secretAccessKey: req.rpc_params.secret_key,
            sslEnabled: false
        });
        return P.ninvoke(s3, "listBuckets");
    }).then(function(data) {
        _.each(data.Buckets, function(bucket) {
            buckets.push(bucket.Name);
        });
        return buckets;
    }).catch(function(err) {
        dbg.error("get_cloud_buckets ERROR", err.stack || err);
        throw err;
    });

}


// UTILS //////////////////////////////////////////////////////////


function find_bucket(req) {
    var bucket = req.system.buckets_by_name[req.rpc_params.name];
    if (!bucket) {
        dbg.error('BUCKET NOT FOUND', req.rpc_params.name);
        throw req.rpc_error('NOT_FOUND', 'missing bucket');
    }
    return bucket;
}

function get_bucket_info(bucket, objects_aggregate, nodes_aggregate_pool, cloud_sync_policy) {
    var info = _.pick(bucket, 'name');
    var objects_aggregate_bucket = objects_aggregate[bucket._id] || {};
    info.tiering = _.map(bucket.tiering, level => ({
        tier: level.tier.name
    }));
    info.num_objects = objects_aggregate_bucket.count || 0;
    var tiers_storage = _.map(bucket.tiering, level => {
        var tier_info = tier_server.get_tier_info(level.tier, nodes_aggregate_pool);
        return tier_info.storage;
    });
    var tiering_storage = size_utils.reduce_storage(size_utils.reduce_sum, tiers_storage, 1, 1);
    info.storage = size_utils.to_bigint_storage({
        used: objects_aggregate_bucket.size || 0,
        total: tiering_storage.total || 0,
        free: tiering_storage.free || 0,
    });
    cs_utils.resolve_cloud_sync_info(cloud_sync_policy, info);
    return info;
}

function resolve_tiering(req, tiering) {
    return _.map(tiering, level => {
        var tier = req.system.tiers_by_name[level.tier];
        if (!tier) {
            dbg.error('TIER NOT FOUND', level.tier);
            throw req.rpc_error('NOT_FOUND', 'missing tier');
        }
        return {
            tier: tier._id
        };
    });
}
