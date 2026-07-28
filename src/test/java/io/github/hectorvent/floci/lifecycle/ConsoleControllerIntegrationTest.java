package io.github.hectorvent.floci.lifecycle;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.startsWith;

@QuarkusTest
class ConsoleControllerIntegrationTest {

    @ParameterizedTest
    @ValueSource(strings = {"/_lcs/console/summary", "/_floci/console/summary", "/_localstack/console/summary"})
    void summary_returnsConsoleMetadata(String path) {
        given()
                .when().get(path)
                .then()
                .statusCode(200)
                .contentType("application/json")
                .body("edition", equalTo("community"))
                .body("version", notNullValue())
                .body("configuredBaseUrl", equalTo("http://localhost:4566"))
                .body("defaultRegion", equalTo("us-east-1"))
                .body("defaultAccountId", equalTo("000000000000"))
                .body("totalCount", greaterThan(10))
                .body("runningCount", greaterThan(0))
                .body("services.find { it.configKey == 's3' }.status", equalTo("running"))
                .body("services.find { it.configKey == 's3' }.defaultProtocol", equalTo("REST_XML"))
                .body("services.find { it.configKey == 's3' }.supportedProtocols", hasItem("REST_XML"))
                .body("services.find { it.configKey == 'lambda' }.defaultProtocol", equalTo("REST_JSON"));
    }

    @Test
    void root_servesDashboard() {
        given()
                .when().get("/")
                .then()
                .statusCode(200)
                .contentType(startsWith("text/html"))
                .body(containsString("LCS Console"))
                .body(containsString("Console home"))
                .body(containsString("AWS-inspired local console backed by live emulator metadata"));
    }

            @ParameterizedTest
            @ValueSource(strings = {"ec2", "s3", "lambda", "dynamodb", "sqs", "sns"})
            void service_pages_returnLiveConsoleData(String serviceId) {
            given()
                .when().get("/_lcs/console/services/{serviceId}", serviceId)
                .then()
                .statusCode(200)
                .contentType("application/json")
                .body("serviceId", equalTo(serviceId))
                .body("displayName", notNullValue())
                .body("headline", notNullValue())
                .body("metrics.size()", greaterThan(0))
                .body("tables.size()", greaterThan(0));
            }

            @Test
            void s3_console_action_creates_bucket_and_selects_it() {
            String bucketName = "console-bucket-" + System.nanoTime();

            given()
                .contentType("application/json")
                .body(Map.of(
                    "bucketName", bucketName,
                    "region", "us-east-1"))
                .when().post("/_lcs/console/services/s3/actions/create-bucket")
                .then()
                .statusCode(200)
                .contentType("application/json")
                .body("serviceId", equalTo("s3"))
                .body("notices", hasItem(containsString("Created bucket " + bucketName + ".")))
                .body("tables.find { it.id == 's3-buckets' }.rows.id", hasItem(bucketName))
                .body("tables.find { it.id == 's3-selected-bucket' }.rows.find { it.id == 'name' }.cells[1]", equalTo(bucketName));
            }

            @Test
            void sqs_console_action_creates_queue_and_selects_it() {
            String queueName = "console-queue-" + System.nanoTime();

            given()
                .contentType("application/json")
                .body(Map.of(
                    "queueName", queueName,
                    "fifoQueue", "false"))
                .when().post("/_lcs/console/services/sqs/actions/create-queue")
                .then()
                .statusCode(200)
                .contentType("application/json")
                .body("serviceId", equalTo("sqs"))
                .body("notices", hasItem(containsString("Created SQS queue " + queueName + ".")))
                .body("tables.find { it.id == 'sqs-queues' }.rows.find { it.cells[0] == '" + queueName + "' }.cells[0]", equalTo(queueName))
                .body("tables.find { it.id == 'sqs-selected-queue' }.rows.find { it.id == 'name' }.cells[1]", equalTo(queueName));
            }
}