// this module is written for both nodejs, or for client with browserify.
'use strict';

var util = require('util');
var stream = require('stream');
var _ = require('lodash');
var Q = require('q');
var object_api = require('../api/object_api');
var Semaphore = require('noobaa-util/semaphore');
var ObjectReader = require('./object_reader');
var ObjectWriter = require('./object_writer');


// exporting the ObjectClient class
module.exports = ObjectClient;



// ctor of the object client.
// the client provides api access to remote object storage.
// the client API functions have the signature function(params), and return a promise.
//
// client_params (Object): see restful_api.init_client()
//
function ObjectClient(client_params) {
    object_api.Client.call(this, client_params);
    this.read_sem = new Semaphore(20);
    this.write_sem = new Semaphore(20);
}

// in addition to the api functions, the client implements more advanced functions
// for read/write of objects according to the object mapping.
util.inherits(ObjectClient, object_api.Client);


ObjectClient.prototype.open_read_stream = function(params) {
    return new ObjectReader(this, params);
};
ObjectClient.prototype.open_write_stream = function(params) {
    return new ObjectWriter(this, params);
};



// write_object_part (API)
//
// params (Object):
//   - bucket (String)
//   - key (String)
//   - start (Number) - object start offset
//   - end (Number) - object end offset
//   - buffer (Buffer) - data to write
//
// return (promise)
//
ObjectClient.prototype.write_object_part = function(params) {
    var self = this;
    var upload_params = _.pick(params, 'bucket', 'key', 'start', 'end');
    console.log('write_object_part', params);

    return self.allocate_object_part(upload_params).then(
        function(part) {
            var buffer_per_index = encode_chunk(part, params.buffer);
            var block_size = (part.chunk_size / part.kblocks) | 0;
            return Q.all(_.map(part.indexes, function(blocks, index) {
                return Q.all(_.map(blocks, function(block) {
                    return write_block(block, buffer_per_index[index], self.write_sem);
                }));
            }));
        }
    );
};


// read_object_range (API)
//
// params (Object):
//   - bucket (String)
//   - key (String)
//   - start (Number) - object start offset
//   - end (Number) - object end offset
//
// return: buffer (promise) - the data. can be shorter than requested if EOF.
//
ObjectClient.prototype.read_object_range = function(params) {
    var self = this;
    console.log('read_object_range', params);

    return self.read_object_mappings(params).then(
        function(mappings) {
            return Q.all(_.map(mappings.parts, self.read_object_part, self));
        }
    ).then(
        function(parts_buffers) {
            // once all parts finish we can construct the complete buffer.
            return Buffer.concat(parts_buffers, params.end - params.start);
        }
    );
};


ObjectClient.prototype.read_object_part = function(part) {
    var self = this;
    var block_size = (part.chunk_size / part.kblocks) | 0;
    var buffer_per_index = {};
    var next_index = 0;

    console.log('read_object_part', part);

    // advancing the read by taking the next index and return promise to read it.
    // will fail if no more indexes remain, which means the part cannot be served.
    function read_the_next_index() {
        while (next_index < part.indexes.length) {
            var curr_index = next_index;
            var blocks = part.indexes[curr_index];
            next_index += 1;
            if (blocks) {
                return read_index_blocks_chain(blocks, curr_index);
            }
        }
        throw new Error('READ PART EXHAUSTED', part);
    }

    function read_index_blocks_chain(blocks, index) {
        console.log('read_index_blocks_chain', index);
        // chain the blocks of the index with array reduce
        // to handle read failures we create a promise chain such that each block of
        // this index will read and if fails it's promise rejection handler will go
        // to read the next block of the index.
        var add_block_promise_to_chain = function(promise, block) {
            return promise.then(null,
                function(err) {
                    console.error('READ FAILED BLOCK', err);
                    return read_block(block, block_size, self.read_sem);
                }
            );
        };
        // chain_initiator is used to fire the first rejection handler for the head of the chain.
        var chain_initiator = Q.reject(index);
        // reduce the blocks array to create the chain and feed it with the initial promise
        return _.reduce(
            blocks,
            add_block_promise_to_chain,
            chain_initiator
        ).then(
            function(buffer) {
                // when done, just keep the buffer and finish this promise chain
                buffer_per_index[index] = buffer;
            }
        ).then(null,
            function(err) {
                // failed to read this index, try another.
                console.error('READ FAILED INDEX', index, err);
                return read_the_next_index();
            }
        );
    }

    // start reading by queueing the first kblocks
    return Q.all(
        _.times(part.kblocks, read_the_next_index)
    ).then(
        function() {
            var buffer = decode_chunk(part, buffer_per_index);
            // cut only the part's relevant range from the chunk
            buffer = buffer.slice(part.chunk_offset, part.end - part.start);
            return buffer;
        }
    );
};



function write_block(block, buffer, sem) {
    // use read semaphore to surround the IO
    return sem.surround(
        function() {
            console.log('write_block', block, buffer);

            // TODO
        }
    );
}


function read_block(block, block_size, sem) {
    // use read semaphore to surround the IO
    return sem.surround(
        function() {
            console.log('read_block', block, block_size);

            // TODO read block from node
            var buffer = new Buffer(block_size);
            buffer.fill(0);

            // verify the received buffer length must be full size
            if (buffer.length !== block_size) {
                throw new Error('BLOCK SHORT READ', block, block_size, buffer);
            }
            return buffer;
        }
    );
}


// for now just encode without erasure coding
function encode_chunk(part, buffer) {
    var buffer_per_index = [];
    var block_size = (part.chunk_size / part.kblocks) | 0;
    for (var i = 0, pos = 0; i < part.kblocks; i++, pos += block_size) {
        buffer_per_index[i] = buffer.slice(pos, pos + block_size);
    }
    return buffer_per_index;
}


// for now just decode without erasure coding
function decode_chunk(part, buffer_per_index) {
    var buffers = [];
    for (var i = 0; i < part.kblocks; i++) {
        buffers[i] = buffer_per_index[i];
        if (!buffer_per_index[i]) {
            throw new Error('DECODE FAILED MISSING BLOCK ' + i);
        }
    }
    return Buffer.concat(buffers, part.chunk_size);
}
