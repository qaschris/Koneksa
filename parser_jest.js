/**
 * call source: delivery script from CI Tool (Jenkins, Bamboo, TeamCity, CircleCI, etc), Launch, locally executed
 *              see 'delivery' subdirectory in this repository
 * payload example:
 * {
 *   properties: 'example value'
 *   arrayOfItems: [ { <properties and example values> } ]
 * }
 * constants:
 * - SCENARIO_PROJECT_ID: 84d46c6a-d39d-11e9-bb65-2a2ae2dbcce4
 * - QTEST_TOKEN: 84d46c6a-d39d-11e9-bb65-2a2ae2dbcce4
 * outputs:
 * - The unformatted items in the payload will be formatted into qTest test case
 * - The test cases then will be added to qTest project
 * - The unformatted result will be sent to the trigger "TriggerName"
 * - The ChatOps channel (if there is any) will notificate the result or error
 */

const request = require('request');
const { Webhooks } = require('@qasymphony/pulse-sdk');

exports.handler = async function ({ event: body, constants, triggers }, context, callback) {
    function emitEvent(name, payload) {
        let t = triggers.find(t => t.name === name);
        return t && new Webhooks().invoke(t, payload);
    }

    var payload = body;
    var projectId = payload.projectId;
    var cycleId = payload.testcycle;
    var customFieldData = payload.customFieldData;

    const getTestCaseFieldsWithAllowedValues = async () => {
        return await new Promise(async (resolve, reject) => {
            var options = {
                'method': 'GET',
                url: 'https://' + constants.ManagerURL + '/api/v3/projects/' + projectId + '/settings/test-cases/fields',
                'headers': {
                    'Authorization': 'Bearer ' + constants.QTEST_TOKEN,
                    'Accept-Type': 'application/json',
                    'Content-Type': 'application/json'
                }
            };
            request(options, function (error, response) {
                if (error) {
                    return reject(error);
                } else {
                    return resolve(response.body);
                }
            });
        });
    };

    var properties = [];
    let fieldAllowedValueDetails;
    let field;

    try {
        await getTestCaseFieldsWithAllowedValues().then((testValueObject) => {
            fieldAllowedValueDetails = JSON.parse(testValueObject);

            var currentFieldValues = fieldAllowedValueDetails.find(({ label }) => label.toLowerCase() === 'type');
            var currentValue = currentFieldValues.allowed_values.find(({ label }) => label.toLowerCase() === 'jest automation');
            field = {
                field_id: currentFieldValues.id,
                field_value: currentValue.value
            };
            properties.push(field);

            for (var key in customFieldData) {
                var currentFieldValues = fieldAllowedValueDetails.find(({ label }) => label.toLowerCase() === key.toLowerCase());
                if (currentFieldValues.data_type === 1 || currentFieldValues.data_type === 2 || currentFieldValues.data_type === 4
                    || currentFieldValues.data_type === 6 || currentFieldValues.data_type === 7 || currentFieldValues.data_type === 9
                    || currentFieldValues.data_type === 12) {
                    field = {
                        field_id: currentFieldValues.id,
                        field_value: customFieldData[key]
                    };
                    properties.push(field);
                }
                else if (currentFieldValues.data_type === 3) {
                    currentValue = currentFieldValues.allowed_values.find(({ label }) => label.toLowerCase() === customFieldData[key].toLowerCase());
                    field = {
                        field_id: currentFieldValues.id,
                        field_value: currentValue.value
                    };
                    properties.push(field);
                }
                else if (currentFieldValues.data_type === 5 || currentFieldValues.data_type === 8 || currentFieldValues.data_type === 17) {
                    try {
                        if (Array.isArray(customFieldData[key])) {
                            currentValue = [];
                            customFieldData[key].forEach(element => {
                                var selectedVal = currentFieldValues.allowed_values.find(({ label }) => label.toLowerCase() === element.toLowerCase());
                                if (selectedVal) {
                                    currentValue.push(selectedVal.value);
                                }
                            });
                            field = {
                                field_id: currentFieldValues.id,
                                field_value: JSON.stringify(currentValue)
                            };
                            properties.push(field);
                        }
                    }
                    catch (multiValError) {
                        console.log("Error in multiple value block : " + multiValError);
                    }
                }
            };

        }).catch((error) => {
            console.log("Error after allowed value call : " + error);
        });
    }
    catch (err) {
        console.log("Error in allowed value call : " + err);
    }

    let testSuitsResult = JSON.parse(Buffer.from(payload.result, 'base64').toString('utf8'));

    var testLogs = [];

    testSuitsResult.testResults.forEach(function (testCase) {
        if (testCase.skipped) {
            return;
        }

        var testcaseName = "";

        if (!testCase.testResults[0].ancestorTitles[0]) {
            var testcaseName = "unnamed";
        }
        else {
            var testcaseName = testCase.testResults[0].ancestorTitles[0].replace('&', 'and');
        }

        TCStatus = "passed";

        var modules = testCase.testFilePath.split('/tests/')[1].split('/');

        if (!modules) {
            modules = ['Unnamed']
        }

        var reportingLog = {
            exe_start_date: new Date(), // TODO These could be passed in
            exe_end_date: new Date(),
            module_names: modules,
            name: testcaseName.replace('&', 'and'),
            automation_content: testCase.testFilePath.replace('&', 'and') + "#" + testcaseName
        };

        var testStepLogs = [];
        order = 0;
        stepNames = [];
        attachments = [];

        testCase.testResults.forEach(function (step) {

            stepNames.push(step.title);

            var status = step.status;
            var actual = step.title.replace('&', 'and');

            if (TCStatus == "passed" && status == "skipped") {
                TCStatus = "skipped";
            }
            else if (status == "failed") {
                TCStatus = "failed";
                actual = step.failureDetails[0].matcherResult.message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
            }
            else if (status == "undefined") {
                TCStatus = "incomplete";
                status = "incomplete";
            }

            var expected = step.keyword ? step.keyword.replace('&', 'and') + " " : "" + step.title.replace('&', 'and');

            if ("location" in step) {
                if (step.location) {
                    expected = step.location;
                }
            }

            var stepLog = {
                order: order,
                description: step.keyword ? step.keyword.replace('&', 'and') + ' ' : "" + step.title.replace('&', 'and'),
                expected_result: step.title.replace('&', 'and'),
                actual_result: actual,
                status: status
            };

            testStepLogs.push(stepLog);
            order++;
        });

        reportingLog.description = stepNames.join("<br/>").replace('&', 'and');
        reportingLog.status = TCStatus;
        reportingLog.test_step_logs = testStepLogs;
        reportingLog.featureName = modules;
        testLogs.push(reportingLog);
    });

    var formattedResults = {
        "projectId": projectId,
        "testcycle": cycleId,
        requiresDecode: true,
        properties: properties,
        "logs": testLogs
    };

    emitEvent('KoneksaDataProcessor', formattedResults);

}