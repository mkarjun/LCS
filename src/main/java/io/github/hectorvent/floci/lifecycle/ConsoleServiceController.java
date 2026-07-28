package io.github.hectorvent.floci.lifecycle;

import io.github.hectorvent.floci.config.EmulatorConfig;
import io.github.hectorvent.floci.core.common.ResolvedServiceCatalog;
import io.github.hectorvent.floci.core.common.ServiceDescriptor;
import io.github.hectorvent.floci.services.ec2.Ec2Service;
import io.github.hectorvent.floci.services.ec2.model.Address;
import io.github.hectorvent.floci.services.ec2.model.Instance;
import io.github.hectorvent.floci.services.ec2.model.KeyPair;
import io.github.hectorvent.floci.services.ec2.model.Reservation;
import io.github.hectorvent.floci.services.ec2.model.SecurityGroup;
import io.github.hectorvent.floci.services.ec2.model.Subnet;
import io.github.hectorvent.floci.services.ec2.model.Volume;
import io.github.hectorvent.floci.services.ec2.model.Vpc;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Path("{prefix:(_lcs|_floci|_localstack)}/console/services")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ConsoleServiceController {

    private final ResolvedServiceCatalog catalog;
    private final EmulatorConfig config;
    private final Ec2Service ec2Service;
        private final ConsoleServiceApplication serviceApplication;

    @Inject
        public ConsoleServiceController(ResolvedServiceCatalog catalog,
                                                                        EmulatorConfig config,
                                                                        Ec2Service ec2Service,
                                                                        ConsoleServiceApplication serviceApplication) {
        this.catalog = catalog;
        this.config = config;
        this.ec2Service = ec2Service;
                this.serviceApplication = serviceApplication;
    }

    @GET
    @Path("/{serviceId}")
        public Response servicePage(@PathParam("serviceId") String serviceId,
                                                                @QueryParam("resourceId") String resourceId) {
                return Response.ok(serviceApplication.buildPage(serviceId, resourceId, null)).build();
        }

        @POST
        @Path("/{serviceId}/actions/{actionId}")
        public Response serviceAction(@PathParam("serviceId") String serviceId,
                                                                  @PathParam("actionId") String actionId,
                                                                  Map<String, Object> request) {
                return Response.ok(serviceApplication.applyAction(serviceId, actionId, request)).build();
    }

    private ConsoleServicePage buildEc2Page(ServiceDescriptor descriptor) {
        String region = config.defaultRegion();
        List<Instance> instances = ec2Service.describeInstances(region, List.of(), Map.of()).stream()
                .map(Reservation::getInstances)
                .flatMap(List::stream)
                .toList();
        List<Vpc> vpcs = ec2Service.describeVpcs(region, List.of(), Map.of());
        List<Subnet> subnets = ec2Service.describeSubnets(region, List.of(), Map.of());
        List<SecurityGroup> securityGroups = ec2Service.describeSecurityGroups(region, List.of(), List.of(), Map.of());
        List<KeyPair> keyPairs = ec2Service.describeKeyPairs(region, List.of(), List.of());
        List<Address> addresses = ec2Service.describeAddresses(region, List.of(), Map.of());
        List<Volume> volumes = ec2Service.describeVolumes(region, List.of(), Map.of());

        List<ConsoleMetric> metrics = List.of(
                new ConsoleMetric("instances", "Instances", String.valueOf(instances.size()), runningTone(instances.size()), "Virtual servers in this region."),
                new ConsoleMetric("vpcs", "VPCs", String.valueOf(vpcs.size()), "neutral", "Network boundary for EC2 resources."),
                new ConsoleMetric("subnets", "Subnets", String.valueOf(subnets.size()), "neutral", "Availability Zone placement targets."),
                new ConsoleMetric("security-groups", "Security groups", String.valueOf(securityGroups.size()), "neutral", "Inbound and outbound firewall rules."),
                new ConsoleMetric("key-pairs", "Key pairs", String.valueOf(keyPairs.size()), "neutral", "SSH credentials available for launches."),
                new ConsoleMetric("elastic-ips", "Elastic IPs", String.valueOf(addresses.size()), "neutral", "Static public addresses tracked by EC2."),
                new ConsoleMetric("volumes", "Volumes", String.valueOf(volumes.size()), "neutral", "Attached and available EBS volumes."));

        List<ConsoleAction> actions = List.of(
                new ConsoleAction(
                        "launch-instance",
                        "Launch instance",
                        "primary",
                        List.of(
                                new ConsoleField("nameTag", "Name", "text", false, "web-1", "", List.of()),
                                new ConsoleField("imageId", "AMI", "text", true, "ami-default", "ami-default", List.of()),
                                new ConsoleField("instanceType", "Instance type", "select", true, null, "t2.micro",
                                        List.of(
                                                new ConsoleOption("t2.micro", "t2.micro"),
                                                new ConsoleOption("t3.micro", "t3.micro"),
                                                new ConsoleOption("m5.large", "m5.large"))),
                                new ConsoleField("subnetId", "Subnet", "select", false, null,
                                        subnets.isEmpty() ? "" : subnets.getFirst().getSubnetId(),
                                        subnets.stream()
                                                .map(subnet -> new ConsoleOption(subnet.getSubnetId(), subnet.getSubnetId() + " · " + subnet.getAvailabilityZone()))
                                                .toList()),
                                new ConsoleField("securityGroupId", "Security group", "select", false, null,
                                        securityGroups.isEmpty() ? "" : securityGroups.getFirst().getGroupId(),
                                        securityGroups.stream()
                                                .map(group -> new ConsoleOption(group.getGroupId(), group.getGroupName() + " · " + group.getGroupId()))
                                                .toList()),
                                new ConsoleField("keyName", "Key pair", "select", false, null, "",
                                        buildKeyPairOptions(keyPairs)))));

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
                "ec2-instances",
                "Instances",
                "Running and recently managed EC2 instances.",
                List.of("Name", "Instance ID", "State", "Type", "Availability Zone", "Private IP", "VPC"),
                instances.stream().map(this::toEc2InstanceRow).toList(),
                "No EC2 instances yet. Launch one from this page."));
        tables.add(new ConsoleTable(
                "ec2-security-groups",
                "Security groups",
                "Security boundaries available to new launches.",
                List.of("Name", "Group ID", "VPC", "Ingress rules", "Egress rules"),
                securityGroups.stream().map(group -> new ConsoleRow(
                        group.getGroupId(),
                        List.of(
                                safe(group.getGroupName()),
                                safe(group.getGroupId()),
                                safe(group.getVpcId()),
                                String.valueOf(group.getIpPermissions().size()),
                                String.valueOf(group.getIpPermissionsEgress().size())),
                        List.of())).toList(),
                "No security groups found."));

        return new ConsoleServicePage(
                descriptor.externalKey(),
                displayName(descriptor.externalKey()),
                "ec2",
                "EC2 Dashboard",
                "Launch, inspect, and manage emulator-backed compute resources.",
                descriptor.enabled() ? "running" : "available",
                metrics,
                actions,
                tables,
                List.of(
                        "Modeled after the AWS EC2 dashboard in small scale: launch first, then inspect state, networking, and attached volumes.",
                        "Default VPC, subnets, and security group are seeded automatically by LCS when EC2 is opened."));
    }

    private ConsoleRow toEc2InstanceRow(Instance instance) {
        String state = instance.getState() == null ? "unknown" : safe(instance.getState().getName());
        return new ConsoleRow(
                instance.getInstanceId(),
                List.of(
                        instanceName(instance),
                        safe(instance.getInstanceId()),
                        state,
                        safe(instance.getInstanceType()),
                        instance.getPlacement() == null ? "-" : safe(instance.getPlacement().getAvailabilityZone()),
                        safe(instance.getPrivateIpAddress()),
                        safe(instance.getVpcId())),
                ec2RowActions(state));
    }

    private List<ConsoleRowAction> ec2RowActions(String state) {
        return switch (state) {
            case "running" -> List.of(
                    new ConsoleRowAction("stop-instance", "Stop", "secondary"),
                    new ConsoleRowAction("terminate-instance", "Terminate", "danger"));
            case "stopped" -> List.of(
                    new ConsoleRowAction("start-instance", "Start", "primary"),
                    new ConsoleRowAction("terminate-instance", "Terminate", "danger"));
            case "terminated" -> List.of();
            default -> List.of(new ConsoleRowAction("terminate-instance", "Terminate", "danger"));
        };
    }

    private ConsoleServicePage buildGenericPage(ServiceDescriptor descriptor) {
        List<ConsoleMetric> metrics = List.of(
                new ConsoleMetric("status", "Status", descriptor.enabled() ? "running" : "available", descriptor.enabled() ? "running" : "available", "Matches the emulator service registry."),
                new ConsoleMetric("protocol", "Default protocol", descriptor.defaultProtocol() == null ? "custom" : descriptor.defaultProtocol().name(), "neutral", "Primary AWS wire protocol for this service."),
                new ConsoleMetric("storage", "Storage mode", descriptor.supportsStorage() ? safe(descriptor.storageMode()) : "none", "neutral", descriptor.supportsStorage() ? "Persistence model for this service." : "Service does not persist emulator state."),
                new ConsoleMetric("credentials", "Credential scopes", descriptor.credentialScopes().isEmpty() ? "none" : String.join(", ", descriptor.credentialScopes()), "neutral", "Scopes accepted by service requests."));

        List<ConsoleTable> tables = List.of(new ConsoleTable(
                descriptor.externalKey() + "-metadata",
                "Service metadata",
                "Current service wiring exported by LCS.",
                List.of("Field", "Value"),
                List.of(
                        metadataRow("External key", descriptor.externalKey()),
                        metadataRow("Config key", descriptor.configKey()),
                        metadataRow("Supported protocols", descriptor.supportedProtocols().stream().map(Enum::name).sorted().reduce((left, right) -> left + ", " + right).orElse("none")),
                        metadataRow("Storage key", safe(descriptor.storageKey())),
                        metadataRow("Storage mode", safe(descriptor.storageMode()))),
                "No metadata available."));

        return new ConsoleServicePage(
                descriptor.externalKey(),
                displayName(descriptor.externalKey()),
                "generic",
                displayName(descriptor.externalKey()),
                "Dedicated console route is live. Resource-specific widgets are the next layer for this service.",
                descriptor.enabled() ? "running" : "available",
                metrics,
                List.of(),
                tables,
                List.of("This service no longer dead-ends in the home panel. It now has a dedicated console page route.",
                        "Next step for this service: wire its primary list/create flows into first-class widgets."));
    }

    private ConsoleRow metadataRow(String field, String value) {
        return new ConsoleRow(field.toLowerCase().replace(' ', '-'), List.of(field, value), List.of());
    }

    private String instanceName(Instance instance) {
        return instance.getTags().stream()
                .filter(tag -> "Name".equals(tag.getKey()))
                .map(tag -> safe(tag.getValue()))
                .findFirst()
                .orElse("-");
    }

    private List<ConsoleOption> buildKeyPairOptions(List<KeyPair> keyPairs) {
        List<ConsoleOption> options = new ArrayList<>();
        options.add(new ConsoleOption("", "None"));
        keyPairs.stream()
                .map(keyPair -> new ConsoleOption(keyPair.getKeyName(), keyPair.getKeyName()))
                .forEach(options::add);
        return options;
    }

    private String displayName(String serviceId) {
        return switch (serviceId) {
            case "acm" -> "ACM";
            case "apigateway" -> "API Gateway";
            case "apigatewayv2" -> "API Gateway V2";
            case "appconfig" -> "AppConfig";
            case "appconfigdata" -> "AppConfig Data";
            case "autoscaling" -> "Auto Scaling";
            case "bedrock-runtime" -> "Bedrock Runtime";
            case "cloudformation" -> "CloudFormation";
            case "codebuild" -> "CodeBuild";
            case "codedeploy" -> "CodeDeploy";
            case "cognito-idp" -> "Cognito";
            case "dynamodb" -> "DynamoDB";
            case "ecr" -> "ECR";
            case "ec2" -> "EC2";
            case "ecs" -> "ECS";
            case "eks" -> "EKS";
            case "firehose" -> "Kinesis Data Firehose";
            case "iam" -> "IAM";
            case "kms" -> "KMS";
            case "msk" -> "MSK";
            case "route53" -> "Route 53";
            case "s3" -> "S3";
            case "ses" -> "SES";
            case "sns" -> "SNS";
            case "sqs" -> "SQS";
            case "ssm" -> "SSM";
            case "states" -> "Step Functions";
            default -> humanize(serviceId);
        };
    }

    private String humanize(String value) {
        StringBuilder builder = new StringBuilder();
        for (String part : value.split("-")) {
            if (!builder.isEmpty()) {
                builder.append(' ');
            }
            if (part.isEmpty()) {
                continue;
            }
            builder.append(Character.toUpperCase(part.charAt(0)));
            if (part.length() > 1) {
                builder.append(part.substring(1));
            }
        }
        return builder.toString();
    }

    private String runningTone(int count) {
        return count > 0 ? "running" : "available";
    }

    private String safe(String value) {
        return Optional.ofNullable(value).filter(candidate -> !candidate.isBlank()).orElse("-");
    }

    public record ConsoleServicePage(
            String serviceId,
            String displayName,
            String shell,
            String headline,
            String subheadline,
            String status,
            List<ConsoleMetric> metrics,
            List<ConsoleAction> actions,
            List<ConsoleTable> tables,
                        List<String> notices,
                        List<ConsoleDetailPane> detailPanes
    ) {
                public ConsoleServicePage(
                                String serviceId,
                                String displayName,
                                String shell,
                                String headline,
                                String subheadline,
                                String status,
                                List<ConsoleMetric> metrics,
                                List<ConsoleAction> actions,
                                List<ConsoleTable> tables,
                                List<String> notices
                ) {
                        this(serviceId, displayName, shell, headline, subheadline, status, metrics, actions, tables, notices, List.of());
                }
    }

    public record ConsoleMetric(
            String id,
            String label,
            String value,
            String tone,
            String description
    ) {
    }

    public record ConsoleAction(
            String id,
            String label,
            String tone,
            List<ConsoleField> fields
    ) {
    }

    public record ConsoleField(
            String name,
            String label,
            String type,
            boolean required,
            String placeholder,
            String defaultValue,
            List<ConsoleOption> options
    ) {
    }

    public record ConsoleOption(
            String value,
            String label
    ) {
    }

    public record ConsoleTable(
            String id,
            String title,
            String description,
            List<String> columns,
            List<ConsoleRow> rows,
            String emptyMessage
    ) {
    }

    public record ConsoleRow(
            String id,
            List<String> cells,
            List<ConsoleRowAction> actions,
            Integer linkCellIndex
    ) {
        public ConsoleRow(
                String id,
                List<String> cells,
                List<ConsoleRowAction> actions
        ) {
            this(id, cells, actions, null);
        }
    }

    public record ConsoleDetailPane(
            String id,
            String label,
            List<ConsoleDetailGroup> groups
    ) {
    }

    public record ConsoleDetailGroup(
            String id,
            String title,
            List<ConsoleDetailItem> items
    ) {
    }

    public record ConsoleDetailItem(
            String label,
            String value,
            String tone
    ) {
    }

    public record ConsoleRowAction(
            String id,
            String label,
            String tone
    ) {
    }
}