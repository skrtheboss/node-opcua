"use strict";
const util = require("util");
const should = require("should");
const async = require("async");

const secure_channel = require("node-opcua-service-secure-channel");
const CloseSecureChannelResponse = secure_channel.CloseSecureChannelResponse;
const { encode_decode_round_trip_test } = require("node-opcua-packet-analyzer/dist/test_helpers");

const { compare_buffers } = require("node-opcua-utils");
const { clone_buffer } = require("node-opcua-buffer-utils");
const { hexDump, makeBufferFromTrace } = require("node-opcua-debug");

const { make_debugLog } = require("node-opcua-debug");
const debugLog = make_debugLog(__filename);

const { MessageBuilder, MessageChunker } = require("..");
const fixture = require("../test_fixtures/fixture_GetEndPointResponse");

describe("SecureMessageChunkManager", function () {
    it("should reconstruct a valid message when message is received in multiple chunks", function (done) {
        // a very large endPointResponse spanning on multiple chunks ...
        const endPointResponse = fixture.fixture2;

        const requestId = 0x1000;

        const chunk_stack = [];

        async.series(
            [
                function (callback) {
                    const options = {
                        requestId: requestId,
                        tokenId: 1
                    };
                    endPointResponse.responseHeader.requestHandle = requestId;

                    const chunker = new MessageChunker();
                    chunker.chunkSecureMessage("MSG", options, endPointResponse, function (err, messageChunk) {
                        if (messageChunk) {
                            chunk_stack.push(clone_buffer(messageChunk));
                        } else {
                            callback();
                        }
                    });
                },

                function (callback) {
                    chunk_stack.length.should.be.greaterThan(0);

                    // let verify that each intermediate chunk is marked with "C" and final chunk is marked with "F"
                    for (let i = 0; i < chunk_stack.length - 1; i++) {
                        String.fromCharCode(chunk_stack[i].readUInt8(3)).should.equal("C");
                    }
                    String.fromCharCode(chunk_stack[chunk_stack.length - 1].readUInt8(3)).should.equal("F");
                    callback();
                },

                function (callback) {
                    chunk_stack.length.should.be.greaterThan(0);

                    // now apply the opposite operation by reconstructing the message from chunk and
                    // decoding the inner object

                    // console.log(" message Builder");
                    const messageBuilder = new MessageBuilder();
                    messageBuilder
                        .on("full_message_body", function (full_message_body) {
                            /** */
                        })
                        .on("message", (reconstructed_message) => {
                            // message has been fully reconstructed here :
                            // check that the reconstructed message equal the original_message

                            //xx console.log("message = ", util.inspect(reconstructed_message, {colors: true,depth: 10}));
                            //xx console.log("origianm= ",  util.inspect(endPointResponse, {colors: true,depth: 10}));

                            reconstructed_message.toString().should.eql(endPointResponse.toString());
                            // check also that requestId has been properly installed by chunkSecureMessage

                            callback();
                        })
                        .on("error", function (errCode) {
                            callback(new Error("Error : code 0x" + errCode.toString(16)));
                        });

                    // feed messageBuilder with
                    chunk_stack.forEach(function (chunk) {
                        // let simulate a real TCP communication
                        // where our messageChunk would be split into several packages ...

                        const l1 = Math.round(chunk.length / 3); // arbitrarily split into 2 packets : 1/3 and 2/3

                        // just for testing the ability to reassemble data block
                        const data1 = chunk.slice(0, l1);
                        const data2 = chunk.slice(l1);

                        messageBuilder.feed(data1);
                        messageBuilder.feed(data2);
                    });
                }
            ],
            done
        );
    });

    it("should receive and handle an ERR message", function (done) {
        const messageBuilder = new MessageBuilder();

        messageBuilder
            .on("full_message_body", function (full_message_body) {
                debugLog(" On raw Buffer \n");
                debugLog(hexDump(full_message_body));
            })
            .on("message", (message) => {
                debugLog(" message ", message);

                message.responseHeader.serviceResult.value.should.eql(0x80820000);

                done();
            })
            .on("error", function (errCode) {
                debugLog(" errCode ", errCode);
                should.fail();
                done(new Error("Unexpected error event received"));
            });

        const packet = makeBufferFromTrace(
            `00000000: 4d 53 47 46 64 00 00 00 0c 00 00 00 01 00 00 00 04 00 00 00 03 00 00 00 01 00 8d 01 00 00 00 00    MSGFd...........................
             00000020: 00 00 00 00 00 00 00 00 00 00 82 80 24 00 00 00 00 00 00 00 80 01 00 00 00 24 00 00 00 55 6e 65    ............$............$...Une
             00000040: 78 70 65 63 74 65 64 20 65 72 72 6f 72 20 70 72 6f 63 65 73 73 69 6e 67 20 72 65 71 75 65 73 74    xpected.error.processing.request
             00000060: 2e 00 00 00                                                                                        ....
             `
        );
        messageBuilder.feed(packet);
    });
    it("should test CloseSecureChannelResponse", function () {
        const response = new CloseSecureChannelResponse({});
        encode_decode_round_trip_test(response);
    });
});
