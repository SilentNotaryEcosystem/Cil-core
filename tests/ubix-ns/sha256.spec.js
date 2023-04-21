"use strict";

const { describe, it } = require("mocha");
const chai = require("chai");
const sinon = require("sinon").createSandbox();
const sha3 = require("js-sha3");
chai.use(require("chai-as-promised"));
const { assert } = chai;

const { Ns: NsContract } = require("./ns");

const factory = require("../testFactory");

const { generateAddress } = require("../testUtil");

let contract;

describe("Sha256", () => {
  before(async function () {
    this.timeout(15000);
    await factory.asyncLoad();
  });

  after(async function () {
    // this.timeout(15000);
  });

  beforeEach(async () => {
    global.value = 0;
    global.callerAddress = generateAddress().toString("hex");
    global.call = sinon.fake();
    contract = new NsContract();
  });

  describe("check SHA256", async () => {
    let objData;

    beforeEach(async () => {
      global.value = 130000;

      objData = {
        objDidDocument: {
          tg: "my-tele-nick",
          email: "my-email@test.com",
        },
        strIssuerName: "Me",
      };
    });

    it('should briefly check SHA256 implementation (we use the same code from "js-sha3" library)', async () => {
      let arrStrings = [
        "11111111111",
        "sdfsdf234sfsf65",
        "00000000000000000",
        "99999999999999999999999",
        "8223fdee79e0e4e9f18b3aafdbd656da29801e2c",
        JSON.stringify(objData),
      ];

      for (const str of arrStrings) {
        assert.equal(contract._sha256(str), sha3.sha3_256(str));
      }
    });
  });
});
