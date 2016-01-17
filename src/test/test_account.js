// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
/* exported describe, it, before, after, beforeEach, afterEach */
'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
var assert = require('assert');
var coretest = require('./coretest');

describe('account', function() {

    var client;
    var NAME = 'bla bla';
    var EMAIL = 'bla@bla.blabla';
    var PASSWORD = 'shhhhhhh';

    beforeEach(function() {
        // create my own account client on each test
        // to prevent contaminating the headers
        client = coretest.new_client();
    });

    describe('account full flow', function() {

        it('works', function(done) {
            this.timeout(20000);
            P.fcall(function() {
                return client.account.create_account({
                    name: NAME,
                    email: EMAIL,
                    password: PASSWORD,
                });
            }).then(function() {
                return client.create_auth_token({
                    email: EMAIL,
                    password: PASSWORD + '!',
                }).then(function() {
                    throw new Error('expected error: unauthorized');
                }, function(err) {
                    assert.strictEqual(err.rpc_code, 'UNAUTHORIZED');
                });
            }).then(function() {
                return client.create_auth_token({
                    email: EMAIL,
                    password: PASSWORD,
                });
            }).then(function() {
                return client.auth.read_auth().then(function(res) {
                    assert.strictEqual(res.account.name, NAME);
                    assert.strictEqual(res.account.email, EMAIL);
                });
            }).then(function() {
                return client.account.read_account().then(function(res) {
                    assert.strictEqual(res.email, EMAIL);
                });
            }).then(function() {
                return client.account.create_account({
                    name: NAME,
                    email: EMAIL,
                    password: PASSWORD,
                }).then(function() {
                    throw new Error('expected error: account already exists');
                }, function(err) {
                    assert.strictEqual(err.rpc_code, 'CONFLICT');
                });
            }).then(function() {
                return client.account.update_account({
                    name: NAME + ' blahhh',
                    email: EMAIL + '123',
                });
            }).then(function() {
                return client.account.read_account().then(function(res) {
                    assert.strictEqual(res.name, NAME + ' blahhh');
                    assert.strictEqual(res.email, EMAIL + '123');
                });
            }).then(function() {
                return client.account.delete_account();
            }).nodeify(done);
        });

    });

});
