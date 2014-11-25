/* jshint node:true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var types = mongoose.Schema.Types;

// data block is a part of a data chunk, and defines storage location.

var data_block_schema = new Schema({

    system: {
        ref: 'System',
        type: types.ObjectId,
        required: true,
    },

    // (chunk,fragment) define the block content
    chunk: {
        ref: 'DataChunk',
        type: types.ObjectId,
        required: true,
    },

    // the fragment in the chunk - see kfrag in DataChunk
    fragment: {
        type: Number,
        required: true,
    },

    // chunk size in bytes
    size: {
        type: Number,
        required: true,
    },

    // each block should define exactly one of these storage options: node or vendor
    // blocks that are stored on multiple storage options should have
    // different blocks with same (chunk,fragment) to describe it.
    node: {
        ref: 'Node',
        type: types.ObjectId,
    },

    vendor: {
        ref: 'Vendor',
        type: types.ObjectId,
    },

});

data_block_schema.index({
    chunk: 1,
    fragment: 1,
}, {
    unique: false
});

data_block_schema.index({
    node: 1,
}, {
    unique: false
});

data_block_schema.index({
    vendor: 1,
}, {
    unique: false
});

data_block_schema.index({
    system: 1,
}, {
    unique: false
});


data_block_schema.pre('save', function(callback) {
    var self = this;
    var has_node = !!self.node;
    var has_vendor = !!self.vendor;
    if (has_node === has_vendor) {
        return callback('DataBlock must have exactly one storage (node/vendor)');
    }
    callback();
});


var DataBlock = module.exports = mongoose.model('DataBlock', data_block_schema);
