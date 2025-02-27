import * as fs from "fs";
import * as path from "path";
import * as should from "should";

import { getFixture } from "node-opcua-test-fixtures";

import { generateAddressSpace } from "../nodeJS";
import { AddressSpace } from "..";

// tslint:disable-next-line:no-var-requires
const describe = require("node-opcua-leak-detector").describeWithLeakDetector;
describe("Issue 132", function (this: any) {
    this.timeout(Math.max(40000,this.timeout()));

    let addressSpace: AddressSpace;

    beforeEach(() => {
        addressSpace = AddressSpace.create();
    });
    afterEach(() => {
        addressSpace.dispose();
    });

    it("#312 - should load a nodeset xml file containing MandatoryPlaceHolder f", async () => {
        const xml_file0 = path.join(__dirname, "../nodesets/mini.Nodeset2.xml");
        const xml_file1 = getFixture("fixture_issue_312_nodeset2.xml");

        fs.existsSync(xml_file0).should.be.eql(true);

        fs.existsSync(xml_file1).should.be.eql(true);

        const xml_files = [xml_file0, xml_file1];
        await generateAddressSpace(addressSpace, xml_files);
    });
});
