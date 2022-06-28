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
        console.log('[DEBUG] (getTestCaseFieldsWithAllowedValues)');
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
    var assigneeText = '';
    let field;

    try {
        await getTestCaseFieldsWithAllowedValues().then((testValueObject) => {
            fieldAllowedValueDetails = JSON.parse(testValueObject);

            var currentFieldValues = fieldAllowedValueDetails.find(({ label }) => label.toLowerCase() === 'type');
            var currentValue = currentFieldValues.allowed_values.find(({ label }) => label.toLowerCase() === 'cucumber automation');
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

    let testResults = JSON.parse(Buffer.from(payload.result, 'base64').toString('utf8'));

    var testLogs = [];

    testResults.forEach(function (feature) {
        var featureName = feature.name;
        feature.elements.forEach(function (testCase) {
            if (testCase.skipped) {
                return;
            }

            if (!testCase.name)
                testCase.name = "Unnamed";

            TCStatus = "passed";

            var reportingLog = {
                exe_start_date: new Date(), // TODO These could be passed in
                exe_end_date: new Date(),
                module_names: [
                    featureName.replace('&', 'and')
                ],
                Type: 'Cucumber Automation',
                name: testCase.name.replace('&', 'and'),
                automation_content: feature.uri + "#" + testCase.name.replace('&', 'and')
            };

            var testStepLogs = [];
            order = 0;
            stepNames = [];
            attachments = [];

            testCase.steps.forEach(function (step) {
                stepNames.push(step.name);

                var status = step.result.status;
                var actual = step.name.replace('&', 'and');

                if (TCStatus == "passed" && status == "skipped") {
                    TCStatus = "skipped";
                }
                if (status == "failed") {
                    TCStatus = "failed";
                    actual = step.result.error_message;
                }
                if (status == "undefined") {
                    TCStatus = "incomplete";
                    status = "incomplete";
                }

                // Are there an attachment for this step?
                if ("embeddings" in step) {
                    console.log("Has attachment");

                    attCount = 0;
                    step.embeddings.forEach(function (att) {
                        attCount++;
                        var attachment = {
                            name: step.name + " Attachment " + attCount,
                            "content_type": att.mime_type,
                            data: att.data
                        };
                        console.log("Attachment: " + attachment.name)

                        attachments.push(attachment);
                    });
                }

                var expected = step.keyword.replace('&', 'and') + " " + step.name.replace('&', 'and');

                if ("location" in step.match) {
                    expected = step.match.location;
                }

                var stepLog = {
                    order: order,
                    description: step.keyword.replace('&', 'and') + ' ' + step.name.replace('&', 'and'),
                    expected_result: step.name.replace('&', 'and'),
                    actual_result: actual,
                    status: status
                };

                testStepLogs.push(stepLog);
                order++;
            });

            reportingLog.attachments = attachments;
            reportingLog.description = stepNames.join("<br/>").replace('&', 'and');
            reportingLog.status = TCStatus;
            reportingLog.test_step_logs = testStepLogs;
            reportingLog.featureName = featureName.replace('&', 'and');
            testLogs.push(reportingLog);
        });
    });

    var formattedResults = {
        "projectId": projectId,
        "testcycle": cycleId,
        properties: properties,
        requiresDecode: true,
        "logs": testLogs
    };

    emitEvent('KoneksaDataProcessor', formattedResults);

}