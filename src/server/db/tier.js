/* jshint node:true */
'use strict';

var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

/**
 *
 * TIER SCHEMA
 *
 * storage tier - either edge or cloud.
 *
 */
var tier_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    name: {
        type: String,
        required: true,
    },

    replicas: {
        type: Number,
    },
    // see data_frags in data_chunk.js
    data_fragments: {
        type: Number,
    },
    parity_fragments: {
        type: Number,
    },

    //Each tier can be composed of pools OR nodes
    //This is done for ease of use in cases of small servers number (use nodes)
    //or large desktop numbers (use pools)
    pools: [{
        ref: 'Pool',
        type: types.ObjectId,
        required: true,
    }],

    data_placement: {
        type: String,
        enum: ['MIRROR', 'SPREAD'],
        required: true,
    },

    // on delete set deletion time
    deleted: {
        type: Date,
    },

}, {
    // we prefer to call ensureIndexes explicitly when needed
    autoIndex: false
});

tier_schema.index({
    system: 1,
    name: 1,
    deleted: 1, // allow to filter deleted
}, {
    unique: true
});

module.exports = mongoose.model('Tier', tier_schema);
