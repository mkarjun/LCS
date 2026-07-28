package io.github.hectorvent.floci.lifecycle;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.github.hectorvent.floci.config.EmulatorConfig;
import io.github.hectorvent.floci.core.common.ResolvedServiceCatalog;
import io.github.hectorvent.floci.core.common.ServiceDescriptor;
import io.github.hectorvent.floci.services.dynamodb.DynamoDbService;
import io.github.hectorvent.floci.services.dynamodb.model.AttributeDefinition;
import io.github.hectorvent.floci.services.dynamodb.model.KeySchemaElement;
import io.github.hectorvent.floci.services.dynamodb.model.TableDefinition;
import io.github.hectorvent.floci.services.ec2.Ec2Service;
import io.github.hectorvent.floci.services.ec2.model.Address;
import io.github.hectorvent.floci.services.ec2.model.Instance;
import io.github.hectorvent.floci.services.ec2.model.InstanceNetworkInterface;
import io.github.hectorvent.floci.services.ec2.model.KeyPair;
import io.github.hectorvent.floci.services.ec2.model.Reservation;
import io.github.hectorvent.floci.services.ec2.model.SecurityGroup;
import io.github.hectorvent.floci.services.ec2.model.Subnet;
import io.github.hectorvent.floci.services.ec2.model.Tag;
import io.github.hectorvent.floci.services.ec2.model.Volume;
import io.github.hectorvent.floci.services.ec2.model.VolumeAttachment;
import io.github.hectorvent.floci.services.ec2.model.Vpc;
import io.github.hectorvent.floci.services.elbv2.ElbV2Service;
import io.github.hectorvent.floci.services.elbv2.model.Listener;
import io.github.hectorvent.floci.services.elbv2.model.LoadBalancer;
import io.github.hectorvent.floci.services.elbv2.model.TargetDescription;
import io.github.hectorvent.floci.services.elbv2.model.TargetGroup;
import io.github.hectorvent.floci.services.iam.IamService;
import io.github.hectorvent.floci.services.iam.model.AccessKey;
import io.github.hectorvent.floci.services.iam.model.IamGroup;
import io.github.hectorvent.floci.services.iam.model.IamPolicy;
import io.github.hectorvent.floci.services.iam.model.IamRole;
import io.github.hectorvent.floci.services.iam.model.IamUser;
import io.github.hectorvent.floci.services.iam.model.InstanceProfile;
import io.github.hectorvent.floci.services.lambda.LambdaService;
import io.github.hectorvent.floci.services.lambda.model.InvocationType;
import io.github.hectorvent.floci.services.lambda.model.InvokeResult;
import io.github.hectorvent.floci.services.lambda.model.LambdaFunction;
import io.github.hectorvent.floci.services.s3.S3Service;
import io.github.hectorvent.floci.services.s3.model.Bucket;
import io.github.hectorvent.floci.services.s3.model.S3Object;
import io.github.hectorvent.floci.services.sns.SnsService;
import io.github.hectorvent.floci.services.sns.model.Subscription;
import io.github.hectorvent.floci.services.sns.model.Topic;
import io.github.hectorvent.floci.services.sqs.SqsService;
import io.github.hectorvent.floci.services.sqs.model.Queue;
import io.quarkus.arc.Arc;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleAction;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleDetailGroup;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleDetailItem;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleDetailPane;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleField;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleMetric;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleOption;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleRow;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleRowAction;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleServicePage;
import io.github.hectorvent.floci.lifecycle.ConsoleServiceController.ConsoleTable;

@ApplicationScoped
public class ConsoleServiceApplication {

    private static final DateTimeFormatter TIMESTAMP_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'")
            .withZone(ZoneOffset.UTC);

    private final ResolvedServiceCatalog catalog;
    private final EmulatorConfig config;
    private final ObjectMapper objectMapper;
    private final Ec2Service ec2Service;
    private final ElbV2Service elbV2Service;
    private final S3Service s3Service;
    private final LambdaService lambdaService;
    private final DynamoDbService dynamoDbService;
    private final SqsService sqsService;
    private final SnsService snsService;
    private IamService iamService;

    public ConsoleServiceApplication() {
        this(
            Arc.container().instance(ResolvedServiceCatalog.class).get(),
            Arc.container().instance(EmulatorConfig.class).get(),
            Arc.container().instance(ObjectMapper.class).get(),
            Arc.container().instance(Ec2Service.class).get(),
            Arc.container().instance(ElbV2Service.class).get(),
            Arc.container().instance(S3Service.class).get(),
            Arc.container().instance(LambdaService.class).get(),
            Arc.container().instance(DynamoDbService.class).get(),
            Arc.container().instance(SqsService.class).get(),
            Arc.container().instance(SnsService.class).get());
    }

    @Inject
    public ConsoleServiceApplication(ResolvedServiceCatalog catalog,
                                     EmulatorConfig config,
                                     ObjectMapper objectMapper,
                                     Ec2Service ec2Service,
                                     ElbV2Service elbV2Service,
                                     S3Service s3Service,
                                     LambdaService lambdaService,
                                     DynamoDbService dynamoDbService,
                                     SqsService sqsService,
                                     SnsService snsService) {
        this.catalog = catalog;
        this.config = config;
        this.objectMapper = objectMapper;
        this.ec2Service = ec2Service;
        this.elbV2Service = elbV2Service;
        this.s3Service = s3Service;
        this.lambdaService = lambdaService;
        this.dynamoDbService = dynamoDbService;
        this.sqsService = sqsService;
        this.snsService = snsService;
    }

    public ConsoleServicePage buildPage(String serviceId, String resourceId, String flashMessage) {
        ServiceDescriptor descriptor = descriptor(serviceId);
        return switch (serviceId) {
            case "ec2" -> buildEc2Page(descriptor, resourceId, flashMessage);
            case "iam" -> buildIamPage(descriptor, resourceId, flashMessage);
            case "s3" -> buildS3Page(descriptor, resourceId, flashMessage);
            case "lambda" -> buildLambdaPage(descriptor, resourceId, flashMessage);
            case "dynamodb" -> buildDynamoDbPage(descriptor, resourceId, flashMessage);
            case "sqs" -> buildSqsPage(descriptor, resourceId, flashMessage);
            case "sns" -> buildSnsPage(descriptor, resourceId, flashMessage);
            default -> buildGenericPage(descriptor, flashMessage);
        };
    }

    public ConsoleServicePage applyAction(String serviceId, String actionId, Map<String, Object> request) {
        ActionResult result = switch (serviceId) {
            case "ec2" -> applyEc2Action(actionId, request);
            case "iam" -> applyIamAction(actionId, request);
            case "s3" -> applyS3Action(actionId, request);
            case "lambda" -> applyLambdaAction(actionId, request);
            case "dynamodb" -> applyDynamoDbAction(actionId, request);
            case "sqs" -> applySqsAction(actionId, request);
            case "sns" -> applySnsAction(actionId, request);
            default -> throw new BadRequestException("No console actions wired for service: " + serviceId);
        };

        return buildPage(serviceId, result.resourceId(), result.message());
    }

    private IamService iamService() {
        if (iamService == null) {
            iamService = Arc.container().instance(IamService.class).get();
        }
        return iamService;
    }

    private ConsoleServicePage buildEc2Page(ServiceDescriptor descriptor, String resourceId, String flashMessage) {
        String region = config.defaultRegion();
        List<Instance> instances = instances(region);
        List<Vpc> vpcs = ec2Service.describeVpcs(region, List.of(), Map.of());
        List<Subnet> subnets = ec2Service.describeSubnets(region, List.of(), Map.of());
        List<SecurityGroup> securityGroups = ec2Service.describeSecurityGroups(region, List.of(), List.of(), Map.of());
        List<KeyPair> keyPairs = ec2Service.describeKeyPairs(region, List.of(), List.of());
        List<Address> addresses = ec2Service.describeAddresses(region, List.of(), Map.of());
        List<Volume> volumes = ec2Service.describeVolumes(region, List.of(), Map.of());
        List<LoadBalancer> loadBalancers = elbV2Service.describeLoadBalancers(region, List.of(), List.of(), null, null);
        List<TargetGroup> targetGroups = elbV2Service.describeTargetGroups(region, null, List.of(), List.of());
        List<Listener> listeners = elbV2Service.describeListeners(region, null, List.of());

        Map<String, String> loadBalancerNamesByArn = new LinkedHashMap<>();
        for (LoadBalancer loadBalancer : loadBalancers) {
            loadBalancerNamesByArn.put(loadBalancer.getLoadBalancerArn(), safe(loadBalancer.getLoadBalancerName()));
        }

        Map<String, String> targetGroupNamesByArn = new LinkedHashMap<>();
        for (TargetGroup targetGroup : targetGroups) {
            targetGroupNamesByArn.put(targetGroup.getTargetGroupArn(), safe(targetGroup.getTargetGroupName()));
        }

        Map<String, List<String>> loadBalancerNamesByTargetGroupArn = new LinkedHashMap<>();
        for (LoadBalancer loadBalancer : loadBalancers) {
            for (TargetGroup targetGroup : elbV2Service.describeTargetGroups(region, loadBalancer.getLoadBalancerArn(), List.of(), List.of())) {
                loadBalancerNamesByTargetGroupArn
                        .computeIfAbsent(targetGroup.getTargetGroupArn(), ignored -> new ArrayList<>())
                        .add(safe(loadBalancer.getLoadBalancerName()));
            }
        }

        String defaultVpcId = vpcs.isEmpty() ? null : vpcs.get(0).getVpcId();
        String defaultSubnetId = subnets.isEmpty() ? "" : subnets.get(0).getSubnetId();
        String secondarySubnetId = subnets.size() > 1 ? subnets.get(1).getSubnetId() : "";

        Instance selectedInstance = selectInstance(instances, resourceId);
        if (selectedInstance != null) {
            return buildEc2InstanceDetailPage(
                descriptor,
                selectedInstance,
                instances,
                addresses,
                volumes,
                flashMessage);
        }

        List<ConsoleMetric> metrics = List.of(
            new ConsoleMetric("instances", "Instances", String.valueOf(instances.size()), runningTone(instances.size()), "Virtual servers in this region."),
            new ConsoleMetric("load-balancers", "Load balancers", String.valueOf(loadBalancers.size()), runningTone(loadBalancers.size()), "Application load balancers exposed by the emulator."),
            new ConsoleMetric("target-groups", "Target groups", String.valueOf(targetGroups.size()), "neutral", "Listener destinations and registered targets."),
            new ConsoleMetric("security-groups", "Security groups", String.valueOf(securityGroups.size()), "neutral", "Inbound and outbound firewall rules."),
            new ConsoleMetric("key-pairs", "Key pairs", String.valueOf(keyPairs.size()), "neutral", "SSH credentials available for launches."),
            new ConsoleMetric("elastic-ips", "Elastic IPs", String.valueOf(addresses.size()), "neutral", "Static public addresses tracked by EC2."),
            new ConsoleMetric("volumes", "Volumes", String.valueOf(volumes.size()), "neutral", "Attached and available EBS volumes."),
            new ConsoleMetric("vpcs", "VPCs", String.valueOf(vpcs.size()), "neutral", "Network boundary for EC2 resources."));

        List<ConsoleAction> actions = buildEc2InventoryActions(instances, keyPairs, subnets, securityGroups, addresses, region, defaultSubnetId, secondarySubnetId);
        List<ConsoleTable> tables = buildEc2InventoryTables(instances, securityGroups, keyPairs, addresses, volumes, loadBalancers, targetGroups, listeners, loadBalancerNamesByArn, targetGroupNamesByArn, loadBalancerNamesByTargetGroupArn);

        return new ConsoleServicePage(
            descriptor.externalKey(),
            displayName(descriptor.externalKey()),
            "ec2",
            "EC2 Dashboard",
            "Launch, inspect, and manage emulator-backed compute, networking, and load-balancing resources.",
            descriptor.enabled() ? "running" : "available",
            metrics,
            actions,
            tables,
            appendFlash(List.of(
                "Modeled after the AWS EC2 console in small scale: launch from inventory, then drill into instance IDs for a dedicated instance page.",
                "Start, stop, and terminate stay aligned with the AWS instance-state workflow.",
                "Create application load balancer builds a load balancer, default listener, and target group in one flow for first-stage parity.",
                "Default VPC, subnets, and security group are seeded automatically when EC2 is opened."), flashMessage),
            List.of());
    }

        private List<ConsoleAction> buildEc2InventoryActions(List<Instance> instances,
                                 List<KeyPair> keyPairs,
                                 List<Subnet> subnets,
                                 List<SecurityGroup> securityGroups,
                                 List<Address> addresses,
                                 String region,
                                 String defaultSubnetId,
                                 String secondarySubnetId) {
        List<ConsoleAction> actions = new ArrayList<>();
        actions.add(new ConsoleAction(
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
                new ConsoleField("keyName", "Key pair (login)", "select", false, null, "", buildKeyPairOptions(keyPairs)),
                new ConsoleField("subnetId", "Subnet", "select", false, null, defaultSubnetId, buildSubnetOptions(subnets)),
                new ConsoleField("securityGroupId", "Security group", "select", false, null,
                    securityGroups.isEmpty() ? "" : securityGroups.get(0).getGroupId(),
                    buildSecurityGroupOptions(securityGroups)))));
        actions.add(new ConsoleAction(
            "create-key-pair",
            "Create key pair",
            "secondary",
            List.of(new ConsoleField("keyName", "Key pair name", "text", true, "dev-key", "", List.of()))));
        actions.add(new ConsoleAction(
            "allocate-address",
            "Allocate Elastic IP",
            "secondary",
            List.of()));
        actions.add(new ConsoleAction(
            "associate-address",
            "Associate Elastic IP",
            "secondary",
            List.of(
                new ConsoleField("allocationId", "Elastic IP allocation", "select", true, null,
                    addresses.stream()
                        .filter(address -> blankToNull(address.getAssociationId()) == null)
                        .findFirst()
                        .map(Address::getAllocationId)
                        .orElse(""),
                    buildAddressOptions(addresses)),
                new ConsoleField("instanceId", "Instance", "select", true, null,
                    instances.stream()
                        .filter(instance -> !"terminated".equals(instanceState(instance)))
                        .findFirst()
                        .map(Instance::getInstanceId)
                        .orElse(""),
                    buildInstanceOptions(instances, false)))));
        actions.add(new ConsoleAction(
            "create-volume",
            "Create volume",
            "secondary",
            List.of(
                new ConsoleField("nameTag", "Name", "text", false, "data-1", "", List.of()),
                new ConsoleField("availabilityZone", "Availability Zone", "select", true, null,
                    defaultIfBlank(defaultSubnetAz(subnets), region + "a"),
                    buildAvailabilityZoneOptions(subnets, region)),
                new ConsoleField("size", "Size (GiB)", "text", true, "8", "8", List.of()),
                new ConsoleField("volumeType", "Volume type", "select", true, null, "gp3",
                    List.of(
                        new ConsoleOption("gp3", "gp3"),
                        new ConsoleOption("gp2", "gp2"),
                        new ConsoleOption("io1", "io1"),
                        new ConsoleOption("st1", "st1"))))));
        actions.add(new ConsoleAction(
            "create-load-balancer",
            "Create application load balancer",
            "secondary",
            List.of(
                new ConsoleField("loadBalancerName", "Load balancer name", "text", true, "web-alb", "", List.of()),
                new ConsoleField("scheme", "Scheme", "select", true, null, "internet-facing",
                    List.of(
                        new ConsoleOption("internet-facing", "Internet-facing"),
                        new ConsoleOption("internal", "Internal"))),
                new ConsoleField("subnetId", "Subnet", "select", false, null, defaultSubnetId, buildSubnetOptions(subnets)),
                new ConsoleField("subnetId2", "Second subnet", "select", false, null, secondarySubnetId, buildOptionalSubnetOptions(subnets)),
                new ConsoleField("securityGroupId", "Security group", "select", false, null,
                    securityGroups.isEmpty() ? "" : securityGroups.get(0).getGroupId(),
                    buildSecurityGroupOptions(securityGroups)),
                new ConsoleField("targetGroupName", "Target group name", "text", false, "web-targets", "", List.of()),
                new ConsoleField("listenerPort", "Listener port", "text", true, "80", "80", List.of()),
                new ConsoleField("targetPort", "Target port", "text", true, "80", "80", List.of()),
                new ConsoleField("targetInstanceId", "Register instance", "select", false, null, "", buildInstanceOptions(instances, true)))));
        return actions;
        }

        private List<ConsoleTable> buildEc2InventoryTables(List<Instance> instances,
                                   List<SecurityGroup> securityGroups,
                                   List<KeyPair> keyPairs,
                                   List<Address> addresses,
                                   List<Volume> volumes,
                                   List<LoadBalancer> loadBalancers,
                                   List<TargetGroup> targetGroups,
                                   List<Listener> listeners,
                                   Map<String, String> loadBalancerNamesByArn,
                                   Map<String, String> targetGroupNamesByArn,
                                   Map<String, List<String>> loadBalancerNamesByTargetGroupArn) {
        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
            "ec2-instances",
            "Instances",
            "Running and recently managed EC2 instances. Click an instance ID to open the dedicated instance page.",
            List.of("Name", "Instance ID", "State", "Type", "Availability Zone", "Private IP", "VPC"),
            instances.stream().map(this::toEc2InstanceRow).toList(),
            "No EC2 instances yet. Launch one from this page."));
        tables.add(new ConsoleTable(
            "ec2-load-balancers",
            "Load balancers",
            "Application load balancers, mirroring the AWS flow of load balancer, listener, and target group resources.",
            List.of("Name", "Scheme", "Type", "State", "DNS name", "Security groups"),
            loadBalancers.stream().map(this::toLoadBalancerRow).toList(),
            "No load balancers yet. Create one to add a listener and default target group."));
        tables.add(new ConsoleTable(
            "ec2-target-groups",
            "Target groups",
            "Listener destinations and registered backend targets.",
            List.of("Name", "Protocol", "Port", "Target type", "Targets", "Load balancers"),
            targetGroups.stream().map(targetGroup -> toTargetGroupRow(targetGroup, loadBalancerNamesByTargetGroupArn)).toList(),
            "No target groups yet."));
        tables.add(new ConsoleTable(
            "ec2-listeners",
            "Listeners",
            "Front-end ports and default actions attached to each load balancer.",
            List.of("Load balancer", "Port", "Protocol", "Default action"),
            listeners.stream().map(listener -> toListenerRow(listener, loadBalancerNamesByArn, targetGroupNamesByArn)).toList(),
            "No listeners yet."));
        tables.add(new ConsoleTable(
            "ec2-elastic-ips",
            "Elastic IPs",
            "Allocate, associate, and release public IPv4 addresses.",
            List.of("Public IP", "Allocation ID", "Association ID", "Instance", "Domain"),
            addresses.stream().map(this::toElasticIpRow).toList(),
            "No Elastic IPs allocated yet."));
        tables.add(new ConsoleTable(
            "ec2-volumes",
            "Volumes",
            "EBS-like storage inventory for this region.",
            List.of("Name", "Volume ID", "State", "Type", "Size", "Availability Zone", "Attached to"),
            volumes.stream().map(this::toVolumeRow).toList(),
            "No EBS volumes yet."));
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
        tables.add(new ConsoleTable(
            "ec2-key-pairs",
            "Key pairs",
            "SSH credentials available for instance launches.",
            List.of("Name", "Key pair ID", "Fingerprint"),
            keyPairs.stream().map(keyPair -> new ConsoleRow(
                keyPair.getKeyName(),
                List.of(safe(keyPair.getKeyName()), safe(keyPair.getKeyPairId()), safe(keyPair.getKeyFingerprint())),
                List.of())).toList(),
            "No key pairs created yet."));
        return tables;
        }

        private ConsoleServicePage buildEc2InstanceDetailPage(ServiceDescriptor descriptor,
                                  Instance selectedInstance,
                                  List<Instance> instances,
                                  List<Address> addresses,
                                  List<Volume> volumes,
                                  String flashMessage) {
        String state = instanceState(selectedInstance);
        List<Address> attachedAddresses = addresses.stream()
            .filter(address -> Objects.equals(address.getInstanceId(), selectedInstance.getInstanceId()))
            .toList();
        List<Volume> attachedVolumes = volumes.stream()
            .filter(volume -> volume.getAttachments().stream().anyMatch(attachment -> Objects.equals(attachment.getInstanceId(), selectedInstance.getInstanceId())))
            .sorted(Comparator.comparing(Volume::getVolumeId))
            .toList();

        List<ConsoleMetric> metrics = List.of(
            new ConsoleMetric("instance-state", "Instance state", state, state, "Current lifecycle state for the selected instance."),
            new ConsoleMetric("public-ip", "Public IPv4", firstNonBlank(publicIpForInstance(selectedInstance, attachedAddresses), "-"), "neutral", "Public IPv4 address currently attached to this instance."),
            new ConsoleMetric("private-ip", "Private IPv4", safe(selectedInstance.getPrivateIpAddress()), "neutral", "Primary private IPv4 address."),
            new ConsoleMetric("availability-zone", "Availability Zone", selectedInstance.getPlacement() == null ? "-" : safe(selectedInstance.getPlacement().getAvailabilityZone()), "neutral", "Placement zone for the instance."),
            new ConsoleMetric("root-volume", "Root volume", safe(selectedInstance.getRootVolumeId()), "neutral", "Root EBS device tracked by the emulator."),
            new ConsoleMetric("security-groups", "Security groups", String.valueOf(selectedInstance.getSecurityGroups().size()), "neutral", "Security groups attached to the primary interface."));

        List<ConsoleAction> actions = ec2RowActions(state).stream()
            .map(action -> new ConsoleAction(action.id(), action.label(), action.tone(), List.of()))
            .toList();

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
            "ec2-instance-volumes",
            "Attached volumes",
            "Volumes currently attached to this instance.",
            List.of("Volume ID", "Device", "State", "Type", "Size", "Delete on termination"),
            attachedVolumes.stream().map(volume -> toInstanceVolumeRow(volume, selectedInstance.getInstanceId())).toList(),
            "No volumes attached to this instance."));
        tables.add(new ConsoleTable(
            "ec2-instance-addresses",
            "Elastic IP addresses",
            "Elastic IPs associated with this instance.",
            List.of("Public IP", "Allocation ID", "Association ID", "Domain"),
            attachedAddresses.stream().map(this::toInstanceAddressRow).toList(),
            "No Elastic IPs associated with this instance."));
        tables.add(new ConsoleTable(
            "ec2-instance-neighbors",
            "Other instances",
            "Remaining instances in this region. Click an instance ID to switch context.",
            List.of("Name", "Instance ID", "State", "Type", "Availability Zone", "Private IP", "VPC"),
            instances.stream()
                .filter(instance -> !Objects.equals(instance.getInstanceId(), selectedInstance.getInstanceId()))
                .map(this::toEc2InstanceRow)
                .toList(),
            "No other instances in this region."));

        String instanceName = instanceName(selectedInstance);
        String nameSuffix = "-".equals(instanceName) ? "" : " (" + instanceName + ")";

        return new ConsoleServicePage(
            descriptor.externalKey(),
            displayName(descriptor.externalKey()),
            "ec2",
            "Instance summary for " + safe(selectedInstance.getInstanceId()) + nameSuffix,
            "Dedicated EC2 instance view modeled after the AWS instance page: summary first, then tabs for details, security, networking, storage, and tags.",
            state,
            metrics,
            actions,
            tables,
            appendFlash(List.of(
                "You reached this page by selecting an instance ID from the EC2 inventory table, matching the core AWS EC2 drill-in flow.",
                "Phase 1 focuses on Details, Security, Networking, Storage, and Tags for the selected instance."), flashMessage),
            buildEc2InstanceDetailPanes(selectedInstance, attachedAddresses, attachedVolumes));
        }

            private List<ConsoleDetailPane> buildEc2InstanceDetailPanes(Instance instance,
                                        List<Address> attachedAddresses,
                                        List<Volume> attachedVolumes) {
            List<ConsoleDetailPane> panes = new ArrayList<>();
            List<ConsoleDetailGroup> detailGroups = List.of(
                detailGroup("instance-summary", "Instance summary", List.of(
                    detailItem("Instance ID", safe(instance.getInstanceId())),
                    detailItem("Public IPv4 address", firstNonBlank(publicIpForInstance(instance, attachedAddresses), "-")),
                    detailItem("Private IPv4 address", safe(instance.getPrivateIpAddress())),
                    detailItem("Public DNS", safe(instance.getPublicDnsName())),
                    detailItem("Private IP DNS name", safe(instance.getPrivateDnsName())),
                    detailItem("Instance state", instanceState(instance), instanceState(instance)),
                    detailItem("Instance type", safe(instance.getInstanceType())),
                    detailItem("VPC ID", safe(instance.getVpcId())),
                    detailItem("Subnet ID", safe(instance.getSubnetId())),
                    detailItem("Instance ARN", instanceArn(instance)))),
                detailGroup("instance-details", "Instance details", List.of(
                    detailItem("AMI ID", safe(instance.getImageId())),
                    detailItem("Key pair", safe(instance.getKeyName())),
                    detailItem("Architecture", safe(instance.getArchitecture())),
                    detailItem("Platform details", "Linux/UNIX"),
                    detailItem("Virtualization type", safe(instance.getVirtualizationType())),
                    detailItem("Hypervisor", safe(instance.getHypervisor())),
                    detailItem("Launch time", formatInstant(instance.getLaunchTime())),
                    detailItem("Root device", safe(instance.getRootDeviceName()) + " · " + safe(instance.getRootDeviceType()))))
            );
            panes.add(new ConsoleDetailPane("details", "Details", detailGroups));
            panes.add(new ConsoleDetailPane(
                "status-and-alarms",
                "Status and alarms",
                List.of(detailGroup("instance-status", "Instance status", List.of(
                    detailItem("Instance state", instanceState(instance), instanceState(instance)),
                    detailItem("Status transition reason", safe(instance.getStateTransitionReason())),
                    detailItem("Instance status checks", "running".equals(instanceState(instance)) ? "passed" : "pending"),
                    detailItem("System status checks", "running".equals(instanceState(instance)) ? "passed" : "pending"),
                    detailItem("Scheduled events", "none"))))));
            panes.add(new ConsoleDetailPane(
                "monitoring",
                "Monitoring",
                List.of(detailGroup("monitoring-summary", "Monitoring", List.of(
                    detailItem("Monitoring", safe(instance.getMonitoring())),
                    detailItem("EBS optimized", booleanLabel(instance.isEbsOptimized())),
                    detailItem("ENA support", booleanLabel(instance.isEnaSupport())),
                    detailItem("Source / destination check", booleanLabel(instance.isSourceDestCheck())),
                    detailItem("SSH host port", instance.getSshHostPort() > 0 ? String.valueOf(instance.getSshHostPort()) : "-"))))));
            panes.add(new ConsoleDetailPane(
                "security",
                "Security",
                List.of(detailGroup("security-summary", "Security", List.of(
                    detailItem("IAM role", safe(instance.getIamInstanceProfileArn())),
                    detailItem("Security groups", joinGroupIdentifiers(instance)),
                    detailItem("Termination protection", booleanLabel(instance.isDisableApiTermination())),
                    detailItem("Stop protection", booleanLabel(instance.isDisableApiStop())),
                    detailItem("Key pair", safe(instance.getKeyName())))))));
            panes.add(new ConsoleDetailPane(
                "networking",
                "Networking",
                List.of(
                    detailGroup("network-addressing", "Addressing", List.of(
                        detailItem("Public IPv4", firstNonBlank(publicIpForInstance(instance, attachedAddresses), "-")),
                        detailItem("Private IPv4", safe(instance.getPrivateIpAddress())),
                        detailItem("Public DNS", safe(instance.getPublicDnsName())),
                        detailItem("Private DNS", safe(instance.getPrivateDnsName())),
                        detailItem("Elastic IP addresses", joinOrDash(attachedAddresses.stream().map(address -> safe(address.getPublicIp())).toList())))),
                    detailGroup("network-interfaces", "Network interfaces", buildNetworkInterfaceItems(instance)))));
            panes.add(new ConsoleDetailPane(
                "storage",
                "Storage",
                List.of(detailGroup("storage-summary", "Storage", List.of(
                    detailItem("Root volume ID", safe(instance.getRootVolumeId())),
                    detailItem("Root device", safe(instance.getRootDeviceName())),
                    detailItem("Attached volumes", String.valueOf(attachedVolumes.size())),
                    detailItem("Volume IDs", joinOrDash(attachedVolumes.stream().map(Volume::getVolumeId).map(this::safe).toList())))))));
            panes.add(new ConsoleDetailPane(
                "tags",
                "Tags",
                List.of(detailGroup("tag-list", "Tags", buildTagItems(instance.getTags())))));
            return panes;
            }

        private Instance selectInstance(List<Instance> instances, String resourceId) {
        String selectedId = blankToNull(resourceId);
        if (selectedId == null) {
            return null;
        }
        return instances.stream()
            .filter(instance -> Objects.equals(instance.getInstanceId(), selectedId))
            .findFirst()
            .orElseThrow(() -> new NotFoundException("Unknown EC2 instance: " + selectedId));
        }

    private ConsoleServicePage buildIamPage(ServiceDescriptor descriptor, String resourceId, String flashMessage) {
        List<IamUser> users = iamService().listUsers("/").stream()
            .sorted(Comparator.comparing(IamUser::getUserName))
            .toList();
        List<IamGroup> groups = iamService().listGroups("/").stream()
            .sorted(Comparator.comparing(IamGroup::getGroupName))
            .toList();
        List<IamRole> roles = iamService().listRoles("/").stream()
            .sorted(Comparator.comparing(IamRole::getRoleName))
            .toList();
        List<IamPolicy> policies = iamService().listPolicies("All", "/").stream()
            .sorted(Comparator.comparing(IamPolicy::getPolicyName))
            .toList();
        List<InstanceProfile> instanceProfiles = iamService().listInstanceProfiles("/").stream()
            .sorted(Comparator.comparing(InstanceProfile::getInstanceProfileName))
            .toList();

        IamUser selectedUser = selectIamUser(users, resourceId);
        if (selectedUser != null) {
            return buildIamUserDetailPage(descriptor, selectedUser, groups, policies, flashMessage);
        }

        IamRole selectedRole = selectIamRole(roles, resourceId);
        if (selectedRole != null) {
            return buildIamRoleDetailPage(descriptor, selectedRole, policies, instanceProfiles, flashMessage);
        }

        IamGroup selectedGroup = selectIamGroup(groups, resourceId);
        if (selectedGroup != null) {
            return buildIamGroupDetailPage(descriptor, selectedGroup, users, policies, flashMessage);
        }

        return buildIamInventoryPage(descriptor, users, groups, roles, policies, instanceProfiles, flashMessage);
    }

    private ConsoleServicePage buildIamInventoryPage(ServiceDescriptor descriptor,
                                                     List<IamUser> users,
                                                     List<IamGroup> groups,
                                                     List<IamRole> roles,
                                                     List<IamPolicy> policies,
                                                     List<InstanceProfile> instanceProfiles,
                                                     String flashMessage) {
        long awsManagedPolicies = policies.stream()
            .filter(policy -> "AWS managed".equals(iamPolicyScope(policy)))
            .count();

        List<ConsoleMetric> metrics = List.of(
            new ConsoleMetric("iam-users", "Users", String.valueOf(users.size()), runningTone(users.size()), "Global IAM users available to SDK and CLI flows."),
            new ConsoleMetric("iam-groups", "Groups", String.valueOf(groups.size()), runningTone(groups.size()), "Shared permission containers for local identities."),
            new ConsoleMetric("iam-roles", "Roles", String.valueOf(roles.size()), runningTone(roles.size()), "Assumable identities with trust policies."),
            new ConsoleMetric("iam-policies", "Policies", String.valueOf(policies.size()), runningTone(policies.size()), "Managed policies seeded and created in local IAM."),
            new ConsoleMetric("iam-aws-managed", "AWS managed", String.valueOf(awsManagedPolicies), "neutral", "AWS managed policies mirrored into the emulator."),
            new ConsoleMetric("iam-instance-profiles", "Instance profiles", String.valueOf(instanceProfiles.size()), runningTone(instanceProfiles.size()), "Profiles that can carry a role into EC2-like launches."));

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
            "iam-users",
            "Users",
            "IAM users in this account. Click a user name to open the summary page.",
            List.of("User name", "User ID", "Path", "Groups", "Managed policies", "Created"),
            users.stream().map(this::toIamUserRow).toList(),
            "No IAM users yet. Create one to issue access keys and attach policies."));
        tables.add(new ConsoleTable(
            "iam-groups",
            "Groups",
            "IAM groups available for shared permission management.",
            List.of("Group name", "Group ID", "Path", "Users", "Managed policies", "Created"),
            groups.stream().map(this::toIamGroupRow).toList(),
            "No IAM groups yet."));
        tables.add(new ConsoleTable(
            "iam-roles",
            "Roles",
            "IAM roles with trust policies and attached permissions. Click a role name to inspect it.",
            List.of("Role name", "Role ID", "Path", "Managed policies", "Max session", "Created"),
            roles.stream().map(this::toIamRoleRow).toList(),
            "No IAM roles yet. Create one for EC2 or Lambda-style workloads."));
        tables.add(new ConsoleTable(
            "iam-policies",
            "Policies",
            "Managed policy inventory spanning AWS managed and customer managed policies.",
            List.of("Policy name", "Type", "Path", "Attachments", "Default version", "ARN"),
            policies.stream().map(this::toIamPolicyInventoryRow).toList(),
            "No IAM policies found."));
        tables.add(new ConsoleTable(
            "iam-instance-profiles",
            "Instance profiles",
            "Profiles that can bind a role to EC2-compatible launches.",
            List.of("Instance profile", "Instance profile ID", "Path", "Roles", "Created"),
            instanceProfiles.stream().map(this::toIamInstanceProfileRow).toList(),
            "No instance profiles yet."));

        return new ConsoleServicePage(
            descriptor.externalKey(),
            displayName(descriptor.externalKey()),
            "iam",
            "IAM Dashboard",
            "Manage local identities, policies, roles, and instance profiles through IAM Query-backed state.",
            descriptor.enabled() ? "running" : "available",
            metrics,
            buildIamInventoryActions(users, groups, roles, policies, instanceProfiles),
            tables,
            appendFlash(List.of(), flashMessage));
    }

    private ConsoleServicePage buildIamUserDetailPage(ServiceDescriptor descriptor,
                                                      IamUser user,
                                                      List<IamGroup> groups,
                                                      List<IamPolicy> policies,
                                                      String flashMessage) {
        List<AccessKey> accessKeys = iamService().listAccessKeys(user.getUserName()).stream()
            .sorted(Comparator.comparing(AccessKey::getCreateDate, Comparator.nullsLast(Comparator.reverseOrder())))
            .toList();
        List<IamGroup> userGroups = groups.stream()
            .filter(group -> user.getGroupNames().contains(group.getGroupName()))
            .toList();
        List<IamPolicy> attachedPolicies = policies.stream()
            .filter(policy -> user.getAttachedPolicyArns().contains(policy.getArn()))
            .toList();

        List<ConsoleMetric> metrics = List.of(
            new ConsoleMetric("iam-user-access-keys", "Access keys", String.valueOf(accessKeys.size()), runningTone(accessKeys.size()), "Programmatic credentials for this user."),
            new ConsoleMetric("iam-user-groups", "Groups", String.valueOf(userGroups.size()), runningTone(userGroups.size()), "Current group memberships."),
            new ConsoleMetric("iam-user-managed-policies", "Managed policies", String.valueOf(attachedPolicies.size()), runningTone(attachedPolicies.size()), "Managed policies attached directly to this user."),
            new ConsoleMetric("iam-user-inline-policies", "Inline policies", String.valueOf(user.getInlinePolicies().size()), runningTone(user.getInlinePolicies().size()), "Inline policies stored on this user."));

        List<ConsoleAction> actions = new ArrayList<>();
        actions.add(new ConsoleAction(
            "create-access-key",
            "Create access key",
            "primary",
            List.of(hiddenResourceField(iamUserResourceId(user.getUserName())))));
        if (!policies.isEmpty()) {
            actions.add(new ConsoleAction(
                "attach-policy",
                "Attach managed policy",
                "secondary",
                List.of(
                    hiddenResourceField(iamUserResourceId(user.getUserName())),
                    new ConsoleField("policyArn", "Policy", "select", true, null, policies.get(0).getArn(), buildIamPolicyOptions(policies)))));
        }

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
            "iam-user-access-keys-table",
            "Access keys",
            "Programmatic credentials currently issued for this user.",
            List.of("Access key ID", "Status", "Created"),
            accessKeys.stream().map(this::toIamAccessKeyRow).toList(),
            "No access keys for this user."));
        tables.add(new ConsoleTable(
            "iam-user-groups-table",
            "Groups",
            "Group memberships for this user. Click a group name to drill in.",
            List.of("Group name", "Group ID", "Path", "Managed policies"),
            userGroups.stream().map(this::toIamMembershipGroupRow).toList(),
            "This user is not in any groups."));
        tables.add(new ConsoleTable(
            "iam-user-managed-policies-table",
            "Managed policies",
            "Managed policies attached directly to this user.",
            List.of("Policy name", "Type", "Attachments", "Default version", "ARN"),
            attachedPolicies.stream().map(this::toIamAttachedPolicyRow).toList(),
            "No managed policies attached to this user."));

        return new ConsoleServicePage(
            descriptor.externalKey(),
            displayName(descriptor.externalKey()),
            "iam",
            "User " + safe(user.getUserName()),
            "Programmatic identity summary, credentials, and permissions for the selected IAM user.",
            descriptor.enabled() ? "running" : "available",
            metrics,
            actions,
            tables,
            appendFlash(List.of(), flashMessage),
            List.of(
                new ConsoleDetailPane(
                    "details",
                    "Details",
                    List.of(detailGroup("user-summary", "Summary", List.of(
                        detailItem("User name", safe(user.getUserName())),
                        detailItem("User ID", safe(user.getUserId())),
                        detailItem("ARN", safe(user.getArn())),
                        detailItem("Path", safe(user.getPath())),
                        detailItem("Created", formatInstant(user.getCreateDate())))))),
                new ConsoleDetailPane(
                    "security-credentials",
                    "Security credentials",
                    List.of(detailGroup("user-security", "Programmatic access", List.of(
                        detailItem("Access keys", String.valueOf(accessKeys.size()), runningTone(accessKeys.size())),
                        detailItem("Password last used", formatInstant(user.getPasswordLastUsed())),
                        detailItem("Secret access key", "Shown only when created from this console"))))),
                new ConsoleDetailPane(
                    "permissions",
                    "Permissions",
                    List.of(
                        detailGroup("user-policy-summary", "Managed and inline policies", List.of(
                            detailItem("Managed policies", String.valueOf(attachedPolicies.size()), runningTone(attachedPolicies.size())),
                            detailItem("Inline policies", String.valueOf(user.getInlinePolicies().size()), runningTone(user.getInlinePolicies().size())),
                            detailItem("Permissions boundary", safe(user.getPermissionsBoundaryArn())))),
                        detailGroup("user-group-summary", "Group memberships", List.of(
                            detailItem("Groups", String.valueOf(userGroups.size()), runningTone(userGroups.size())),
                            detailItem("Member of", joinOrDash(userGroups.stream().map(IamGroup::getGroupName).toList())),
                            detailItem("Inline policy names", user.getInlinePolicies().isEmpty() ? "-" : String.join(", ", user.getInlinePolicies().keySet().stream().sorted().toList())))))),
                new ConsoleDetailPane(
                    "tags",
                    "Tags",
                    List.of(detailGroup("user-tags", "Tags", buildTagItems(user.getTags()))))));
    }

    private ConsoleServicePage buildIamRoleDetailPage(ServiceDescriptor descriptor,
                                                      IamRole role,
                                                      List<IamPolicy> policies,
                                                      List<InstanceProfile> instanceProfiles,
                                                      String flashMessage) {
        List<IamPolicy> attachedPolicies = policies.stream()
            .filter(policy -> role.getAttachedPolicyArns().contains(policy.getArn()))
            .toList();
        List<InstanceProfile> roleProfiles = instanceProfiles.stream()
            .filter(profile -> profile.getRoleNames().contains(role.getRoleName()))
            .toList();

        List<ConsoleMetric> metrics = List.of(
            new ConsoleMetric("iam-role-managed-policies", "Managed policies", String.valueOf(attachedPolicies.size()), runningTone(attachedPolicies.size()), "Managed policies attached to this role."),
            new ConsoleMetric("iam-role-inline-policies", "Inline policies", String.valueOf(role.getInlinePolicies().size()), runningTone(role.getInlinePolicies().size()), "Inline policies stored on this role."),
            new ConsoleMetric("iam-role-instance-profiles", "Instance profiles", String.valueOf(roleProfiles.size()), runningTone(roleProfiles.size()), "Instance profiles bound to this role."),
            new ConsoleMetric("iam-role-max-session", "Max session", formatDurationSeconds(role.getMaxSessionDuration()), "neutral", "Configured max session duration for STS assumptions."));

        List<ConsoleAction> actions = new ArrayList<>();
        if (!policies.isEmpty()) {
            actions.add(new ConsoleAction(
                "attach-policy",
                "Attach managed policy",
                "primary",
                List.of(
                    hiddenResourceField(iamRoleResourceId(role.getRoleName())),
                    new ConsoleField("policyArn", "Policy", "select", true, null, policies.get(0).getArn(), buildIamPolicyOptions(policies)))));
        }
        if (!instanceProfiles.isEmpty()) {
            actions.add(new ConsoleAction(
                "add-role-to-instance-profile",
                "Add to instance profile",
                "secondary",
                List.of(
                    hiddenResourceField(iamRoleResourceId(role.getRoleName())),
                    new ConsoleField("instanceProfileName", "Instance profile", "select", true, null, instanceProfiles.get(0).getInstanceProfileName(), buildIamInstanceProfileOptions(instanceProfiles)))));
        }

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
            "iam-role-managed-policies-table",
            "Managed policies",
            "Managed policies attached directly to this role.",
            List.of("Policy name", "Type", "Attachments", "Default version", "ARN"),
            attachedPolicies.stream().map(this::toIamAttachedPolicyRow).toList(),
            "No managed policies attached to this role."));
        tables.add(new ConsoleTable(
            "iam-role-instance-profiles-table",
            "Instance profiles",
            "Instance profiles that reference this role.",
            List.of("Instance profile", "Instance profile ID", "Path", "Roles", "Created"),
            roleProfiles.stream().map(this::toIamInstanceProfileRow).toList(),
            "No instance profiles reference this role."));

        return new ConsoleServicePage(
            descriptor.externalKey(),
            displayName(descriptor.externalKey()),
            "iam",
            "Role " + safe(role.getRoleName()),
            "Trust policy, permissions, and instance profile summary for the selected IAM role.",
            descriptor.enabled() ? "running" : "available",
            metrics,
            actions,
            tables,
            appendFlash(List.of(), flashMessage),
            List.of(
                new ConsoleDetailPane(
                    "details",
                    "Details",
                    List.of(detailGroup("role-summary", "Summary", List.of(
                        detailItem("Role name", safe(role.getRoleName())),
                        detailItem("Role ID", safe(role.getRoleId())),
                        detailItem("ARN", safe(role.getArn())),
                        detailItem("Path", safe(role.getPath())),
                        detailItem("Description", safe(role.getDescription())),
                        detailItem("Created", formatInstant(role.getCreateDate())))))),
                new ConsoleDetailPane(
                    "trust-relationships",
                    "Trust relationships",
                    List.of(detailGroup("role-trust-policy", "AssumeRole policy", List.of(
                        detailItem("Max session duration", formatDurationSeconds(role.getMaxSessionDuration())),
                        detailItem("Trust policy", truncate(safe(role.getAssumeRolePolicyDocument()), 320)))))),
                new ConsoleDetailPane(
                    "permissions",
                    "Permissions",
                    List.of(detailGroup("role-policy-summary", "Managed and inline policies", List.of(
                        detailItem("Managed policies", String.valueOf(attachedPolicies.size()), runningTone(attachedPolicies.size())),
                        detailItem("Inline policies", String.valueOf(role.getInlinePolicies().size()), runningTone(role.getInlinePolicies().size())),
                        detailItem("Permissions boundary", safe(role.getPermissionsBoundaryArn())),
                        detailItem("Inline policy names", role.getInlinePolicies().isEmpty() ? "-" : String.join(", ", role.getInlinePolicies().keySet().stream().sorted().toList())))))),
                new ConsoleDetailPane(
                    "instance-profiles",
                    "Instance profiles",
                    List.of(detailGroup("role-instance-profiles", "Usage", List.of(
                        detailItem("Instance profiles", String.valueOf(roleProfiles.size()), runningTone(roleProfiles.size())),
                        detailItem("Profile names", joinOrDash(roleProfiles.stream().map(InstanceProfile::getInstanceProfileName).toList())))))),
                new ConsoleDetailPane(
                    "tags",
                    "Tags",
                    List.of(detailGroup("role-tags", "Tags", buildTagItems(role.getTags()))))));
    }

    private ConsoleServicePage buildIamGroupDetailPage(ServiceDescriptor descriptor,
                                                       IamGroup group,
                                                       List<IamUser> users,
                                                       List<IamPolicy> policies,
                                                       String flashMessage) {
        List<IamUser> members = users.stream()
            .filter(user -> group.getUserNames().contains(user.getUserName()))
            .toList();
        List<IamPolicy> attachedPolicies = policies.stream()
            .filter(policy -> group.getAttachedPolicyArns().contains(policy.getArn()))
            .toList();

        List<ConsoleMetric> metrics = List.of(
            new ConsoleMetric("iam-group-users", "Users", String.valueOf(members.size()), runningTone(members.size()), "Users currently assigned to this group."),
            new ConsoleMetric("iam-group-managed-policies", "Managed policies", String.valueOf(attachedPolicies.size()), runningTone(attachedPolicies.size()), "Managed policies attached to this group."),
            new ConsoleMetric("iam-group-inline-policies", "Inline policies", String.valueOf(group.getInlinePolicies().size()), runningTone(group.getInlinePolicies().size()), "Inline policies stored on this group."),
            new ConsoleMetric("iam-group-path", "Path", safe(group.getPath()), "neutral", "IAM path for this group."));

        List<ConsoleAction> actions = new ArrayList<>();
        if (!policies.isEmpty()) {
            actions.add(new ConsoleAction(
                "attach-policy",
                "Attach managed policy",
                "primary",
                List.of(
                    hiddenResourceField(iamGroupResourceId(group.getGroupName())),
                    new ConsoleField("policyArn", "Policy", "select", true, null, policies.get(0).getArn(), buildIamPolicyOptions(policies)))));
        }

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
            "iam-group-users-table",
            "Users",
            "Users currently assigned to this group. Click a user name to drill in.",
            List.of("User name", "User ID", "Path", "Groups", "Managed policies", "Created"),
            members.stream().map(this::toIamGroupUserRow).toList(),
            "No users belong to this group."));
        tables.add(new ConsoleTable(
            "iam-group-managed-policies-table",
            "Managed policies",
            "Managed policies attached directly to this group.",
            List.of("Policy name", "Type", "Attachments", "Default version", "ARN"),
            attachedPolicies.stream().map(this::toIamAttachedPolicyRow).toList(),
            "No managed policies attached to this group."));

        return new ConsoleServicePage(
            descriptor.externalKey(),
            displayName(descriptor.externalKey()),
            "iam",
            "Group " + safe(group.getGroupName()),
            "Membership and permission summary for the selected IAM group.",
            descriptor.enabled() ? "running" : "available",
            metrics,
            actions,
            tables,
            appendFlash(List.of(), flashMessage),
            List.of(
                new ConsoleDetailPane(
                    "details",
                    "Details",
                    List.of(detailGroup("group-summary", "Summary", List.of(
                        detailItem("Group name", safe(group.getGroupName())),
                        detailItem("Group ID", safe(group.getGroupId())),
                        detailItem("ARN", safe(group.getArn())),
                        detailItem("Path", safe(group.getPath())),
                        detailItem("Created", formatInstant(group.getCreateDate())))))),
                new ConsoleDetailPane(
                    "permissions",
                    "Permissions",
                    List.of(detailGroup("group-policy-summary", "Managed and inline policies", List.of(
                        detailItem("Managed policies", String.valueOf(attachedPolicies.size()), runningTone(attachedPolicies.size())),
                        detailItem("Inline policies", String.valueOf(group.getInlinePolicies().size()), runningTone(group.getInlinePolicies().size())),
                        detailItem("Inline policy names", group.getInlinePolicies().isEmpty() ? "-" : String.join(", ", group.getInlinePolicies().keySet().stream().sorted().toList())))))),
                new ConsoleDetailPane(
                    "users",
                    "Users",
                    List.of(detailGroup("group-membership", "Membership", List.of(
                        detailItem("Users", String.valueOf(members.size()), runningTone(members.size())),
                        detailItem("User names", joinOrDash(members.stream().map(IamUser::getUserName).toList()))))))));
    }

    private ConsoleServicePage buildS3Page(ServiceDescriptor descriptor, String resourceId, String flashMessage) {
        List<Bucket> buckets = s3Service.listBuckets().stream()
                .sorted(Comparator.comparing(Bucket::getName))
                .toList();
        Bucket selectedBucket = selectBucket(buckets, resourceId);
        List<S3Object> objects = selectedBucket == null
                ? List.of()
                : s3Service.listObjects(selectedBucket.getName(), null, null, 100).stream()
                        .sorted(Comparator.comparing(S3Object::getKey))
                        .toList();

        List<ConsoleMetric> metrics = List.of(
                new ConsoleMetric("buckets", "Buckets", String.valueOf(buckets.size()), runningTone(buckets.size()), "Bucket list for the active account."),
                new ConsoleMetric("selected-objects", "Selected bucket objects", String.valueOf(objects.size()), "neutral", selectedBucket == null ? "Open a bucket to browse objects." : "Current object listing preview."),
                new ConsoleMetric("bucket-region", "Selected region", selectedBucket == null ? config.defaultRegion() : safe(selectedBucket.getRegion()), "neutral", "Bucket region chosen at create time."),
                new ConsoleMetric("versioning", "Versioning", selectedBucket == null ? "-" : safe(selectedBucket.getVersioningStatus()), "neutral", "Bucket versioning state."));

        List<ConsoleAction> actions = new ArrayList<>();
        actions.add(new ConsoleAction(
                "create-bucket",
                "Create bucket",
                "primary",
                List.of(
                        new ConsoleField("bucketName", "Bucket name", "text", true, "demo-bucket", "", List.of()),
                        new ConsoleField("region", "Region", "text", false, config.defaultRegion(), config.defaultRegion(), List.of()))));
        if (!buckets.isEmpty()) {
            actions.add(new ConsoleAction(
                    "put-object",
                    "Upload text object",
                    "secondary",
                    List.of(
                            new ConsoleField("bucketName", "Bucket", "select", true, null,
                                    selectedBucket == null ? buckets.get(0).getName() : selectedBucket.getName(),
                                    buckets.stream().map(bucket -> new ConsoleOption(bucket.getName(), bucket.getName())).toList()),
                            new ConsoleField("objectKey", "Object key", "text", true, "notes/hello.txt", "", List.of()),
                            new ConsoleField("body", "Body", "textarea", true, null, "Hello from LCS console", List.of()))));
        }

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
                "s3-buckets",
                "Buckets",
                "Bucket-level inventory similar to the AWS S3 landing page.",
                List.of("Name", "Region", "Created", "Versioning", "Tags"),
                buckets.stream().map(bucket -> new ConsoleRow(
                        bucket.getName(),
                        List.of(
                                bucket.getName(),
                                safe(bucket.getRegion()),
                                formatInstant(bucket.getCreationDate()),
                                safe(bucket.getVersioningStatus()),
                                String.valueOf(bucket.getTags().size())),
                        List.of(new ConsoleRowAction("open-resource", "Open", "secondary")))).toList(),
                "No buckets yet. Create one from this page."));
        if (selectedBucket != null) {
            tables.add(new ConsoleTable(
                    "s3-selected-bucket",
                    "Selected bucket",
                    "Bucket configuration snapshot.",
                    List.of("Field", "Value"),
                    List.of(
                            metadataRow("Name", selectedBucket.getName()),
                            metadataRow("Region", safe(selectedBucket.getRegion())),
                            metadataRow("Created", formatInstant(selectedBucket.getCreationDate())),
                            metadataRow("Versioning", safe(selectedBucket.getVersioningStatus())),
                            metadataRow("Object lock", String.valueOf(selectedBucket.isObjectLockEnabled()))),
                    "No bucket selected."));
            tables.add(new ConsoleTable(
                    "s3-objects",
                    "Objects",
                    "Current object listing for the selected bucket.",
                    List.of("Key", "Size", "Last modified", "Content type", "Storage class"),
                    objects.stream().map(object -> new ConsoleRow(
                            object.getKey(),
                            List.of(
                                    safe(object.getKey()),
                                    String.valueOf(object.getSize()),
                                    formatInstant(object.getLastModified()),
                                    safe(object.getContentType()),
                                    safe(object.getStorageClass())),
                            List.of())).toList(),
                    "No objects yet in this bucket."));
        }

        return new ConsoleServicePage(
                descriptor.externalKey(),
                displayName(descriptor.externalKey()),
                "s3",
                "S3 Buckets",
                "Browse buckets first, then drill into object keys and metadata.",
                descriptor.enabled() ? "running" : "available",
                metrics,
                actions,
                tables,
                appendFlash(List.of(
                        "AWS S3 console behavior in small scale: bucket inventory first, then object listings inside a selected bucket.",
                        "Object upload here is text-only on purpose to keep the browser flow simple while still writing through the real S3 service."), flashMessage));
    }

    private ConsoleServicePage buildLambdaPage(ServiceDescriptor descriptor, String resourceId, String flashMessage) {
        String region = config.defaultRegion();
        List<LambdaFunction> functions = lambdaService.listFunctions(region).stream()
                .sorted(Comparator.comparing(LambdaFunction::getFunctionName))
                .toList();
        LambdaFunction selectedFunction = selectFunction(functions, resourceId);

        List<ConsoleMetric> metrics = List.of(
                new ConsoleMetric("functions", "Functions", String.valueOf(functions.size()), runningTone(functions.size()), "Functions available in the region."),
                new ConsoleMetric("selected-runtime", "Selected runtime", selectedFunction == null ? "-" : safe(selectedFunction.getRuntime()), "neutral", "Runtime of the selected function."),
                new ConsoleMetric("selected-memory", "Selected memory", selectedFunction == null ? "-" : selectedFunction.getMemorySize() + " MB", "neutral", "Configured memory size."),
                new ConsoleMetric("selected-timeout", "Selected timeout", selectedFunction == null ? "-" : selectedFunction.getTimeout() + " s", "neutral", "Configured execution timeout."));

        List<ConsoleAction> actions = new ArrayList<>();
        actions.add(new ConsoleAction(
                "create-function",
                "Create function",
                "primary",
                List.of(
                        new ConsoleField("functionName", "Function name", "text", true, "hello-world", "", List.of()),
                        new ConsoleField("runtime", "Runtime", "select", true, null, "nodejs20.x",
                                List.of(new ConsoleOption("nodejs20.x", "nodejs20.x"))),
                        new ConsoleField("handler", "Handler", "text", true, "index.handler", "index.handler", List.of()),
                        new ConsoleField("role", "Role ARN", "text", true, defaultLambdaRoleArn(), defaultLambdaRoleArn(), List.of()))));
        if (selectedFunction != null) {
            actions.add(new ConsoleAction(
                    "invoke-function",
                    "Test invoke",
                    "secondary",
                    List.of(
                            new ConsoleField("resourceId", "Function", "text", true, null, selectedFunction.getFunctionName(), List.of()),
                            new ConsoleField("payload", "Payload", "textarea", true, null, "{\n  \"message\": \"hello\"\n}", List.of()))));
        }

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
                "lambda-functions",
                "Functions",
                "Closest AWS console equivalent: function list first, then code and test flow on selection.",
                List.of("Name", "Runtime", "State", "Memory", "Timeout", "Last modified"),
                functions.stream().map(function -> new ConsoleRow(
                        function.getFunctionName(),
                        List.of(
                                safe(function.getFunctionName()),
                                safe(function.getRuntime()),
                                safe(function.getState()),
                                function.getMemorySize() + " MB",
                                function.getTimeout() + " s",
                                formatEpochMillis(function.getLastModified())),
                        List.of(
                                new ConsoleRowAction("open-resource", "Open", "secondary"),
                                new ConsoleRowAction("invoke-function", "Invoke", "primary"),
                                new ConsoleRowAction("delete-function", "Delete", "danger")))).toList(),
                "No Lambda functions yet."));
        if (selectedFunction != null) {
            tables.add(new ConsoleTable(
                    "lambda-selected-function",
                    "Selected function",
                    "Configuration snapshot for the selected Lambda function.",
                    List.of("Field", "Value"),
                    List.of(
                            metadataRow("Name", selectedFunction.getFunctionName()),
                            metadataRow("ARN", safe(selectedFunction.getFunctionArn())),
                            metadataRow("Runtime", safe(selectedFunction.getRuntime())),
                            metadataRow("Handler", safe(selectedFunction.getHandler())),
                            metadataRow("State", safe(selectedFunction.getState())),
                            metadataRow("Memory", selectedFunction.getMemorySize() + " MB"),
                            metadataRow("Timeout", selectedFunction.getTimeout() + " s"),
                            metadataRow("Code size", String.valueOf(selectedFunction.getCodeSizeBytes()))),
                    "No function selected."));
        }

        return new ConsoleServicePage(
                descriptor.externalKey(),
                displayName(descriptor.externalKey()),
                "lambda",
                "Lambda Functions",
                "Author from scratch, inspect configuration, then test invoke from the console.",
                descriptor.enabled() ? "running" : "available",
                metrics,
                actions,
                tables,
                appendFlash(List.of(
                        "Mirrors the AWS Lambda console flow in small scale: create function, open configuration, run a test event.",
                        "Create action provisions a real LCS Lambda function backed by an inline Node.js deployment package."), flashMessage));
    }

    private ConsoleServicePage buildDynamoDbPage(ServiceDescriptor descriptor, String resourceId, String flashMessage) {
        String region = config.defaultRegion();
        List<String> tableNames = dynamoDbService.listTables(region);
        String selectedTableName = selectName(tableNames, resourceId);
        TableDefinition selectedTable = selectedTableName == null ? null : dynamoDbService.describeTable(selectedTableName, region);
        List<JsonNode> previewItems = selectedTable == null
                ? List.of()
                : dynamoDbService.scan(selectedTable.getTableName(), null, null, null, null, 25, null, region).items();

        List<ConsoleMetric> metrics = List.of(
                new ConsoleMetric("tables", "Tables", String.valueOf(tableNames.size()), runningTone(tableNames.size()), "Tables available in the region."),
                new ConsoleMetric("selected-status", "Selected status", selectedTable == null ? "-" : safe(selectedTable.getTableStatus()), "neutral", "Current lifecycle state for the selected table."),
                new ConsoleMetric("selected-items", "Selected item count", selectedTable == null ? "0" : String.valueOf(selectedTable.getItemCount()), "neutral", "Persisted item count reported by the table definition."),
                new ConsoleMetric("preview-items", "Preview rows", String.valueOf(previewItems.size()), "neutral", "First 25 rows from a Scan preview."));

        List<ConsoleAction> actions = List.of(new ConsoleAction(
                "create-table",
                "Create table",
                "primary",
                List.of(
                        new ConsoleField("tableName", "Table name", "text", true, "orders", "", List.of()),
                        new ConsoleField("partitionKey", "Partition key", "text", true, "pk", "pk", List.of()),
                        new ConsoleField("partitionType", "Partition key type", "select", true, null, "S",
                                List.of(new ConsoleOption("S", "String"), new ConsoleOption("N", "Number"), new ConsoleOption("B", "Binary"))),
                        new ConsoleField("sortKey", "Sort key", "text", false, "sk", "", List.of()),
                        new ConsoleField("sortType", "Sort key type", "select", false, null, "S",
                                List.of(new ConsoleOption("S", "String"), new ConsoleOption("N", "Number"), new ConsoleOption("B", "Binary"))))));

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
                "dynamodb-tables",
                "Tables",
                "AWS-style entry point: table inventory with schema summary.",
                List.of("Name", "Status", "Partition key", "Sort key", "Items", "Billing"),
                tableNames.stream().map(tableName -> {
                    TableDefinition table = dynamoDbService.describeTable(tableName, region);
                    return new ConsoleRow(
                            tableName,
                            List.of(
                                    tableName,
                                    safe(table.getTableStatus()),
                                    safe(table.getPartitionKeyName()),
                                    safe(table.getSortKeyName()),
                                    String.valueOf(table.getItemCount()),
                                    safe(table.getBillingMode())),
                            List.of(new ConsoleRowAction("open-resource", "Open", "secondary")));
                }).toList(),
                "No tables yet."));
        if (selectedTable != null) {
            tables.add(new ConsoleTable(
                    "dynamodb-selected-table",
                    "Selected table",
                    "Schema and lifecycle details for the selected table.",
                    List.of("Field", "Value"),
                    List.of(
                            metadataRow("Table", selectedTable.getTableName()),
                            metadataRow("ARN", safe(selectedTable.getTableArn())),
                            metadataRow("Status", safe(selectedTable.getTableStatus())),
                            metadataRow("Partition key", safe(selectedTable.getPartitionKeyName())),
                            metadataRow("Sort key", safe(selectedTable.getSortKeyName())),
                            metadataRow("Billing mode", safe(selectedTable.getBillingMode())),
                            metadataRow("Created", formatInstant(selectedTable.getCreationDateTime()))),
                    "No table selected."));
            tables.add(new ConsoleTable(
                    "dynamodb-preview-items",
                    "Item preview",
                    "First page of Scan output for the selected table.",
                    List.of("Primary key", "Attributes"),
                    previewItems.stream().map(item -> new ConsoleRow(
                            dynamoPrimaryKey(selectedTable, item),
                            List.of(dynamoPrimaryKey(selectedTable, item), compactJson(item)),
                            List.of())).toList(),
                    "No items in this table yet."));
        }

        return new ConsoleServicePage(
                descriptor.externalKey(),
                displayName(descriptor.externalKey()),
                "dynamodb",
                "DynamoDB Tables",
                "Create tables first, then inspect schema and row previews from the console.",
                descriptor.enabled() ? "running" : "available",
                metrics,
                actions,
                tables,
                appendFlash(List.of(
                        "Matches the AWS DynamoDB console pattern in small scale: table inventory, schema view, item preview.",
                        "Preview uses a real Scan request against the selected table."), flashMessage));
    }

    private ConsoleServicePage buildSqsPage(ServiceDescriptor descriptor, String resourceId, String flashMessage) {
        String region = config.defaultRegion();
        List<Queue> queues = sqsService.listQueues(null, region).stream()
                .sorted(Comparator.comparing(Queue::getQueueName))
                .toList();
        Queue selectedQueue = selectQueue(queues, resourceId);

        List<ConsoleMetric> metrics = List.of(
                new ConsoleMetric("queues", "Queues", String.valueOf(queues.size()), runningTone(queues.size()), "Queues available in the region."),
                new ConsoleMetric("selected-type", "Selected type", selectedQueue == null ? "-" : (selectedQueue.isFifo() ? "FIFO" : "Standard"), "neutral", "Queue type for the selected queue."),
                new ConsoleMetric("visible-messages", "Visible messages", selectedQueue == null ? "-" : safe(selectedQueue.getAttributes().get("ApproximateNumberOfMessages")), "neutral", "Approximate visible message count."),
                new ConsoleMetric("delayed-messages", "Delayed messages", selectedQueue == null ? "-" : safe(selectedQueue.getAttributes().get("ApproximateNumberOfMessagesDelayed")), "neutral", "Approximate delayed message count."));

        List<ConsoleAction> actions = List.of(new ConsoleAction(
                "create-queue",
                "Create queue",
                "primary",
                List.of(
                        new ConsoleField("queueName", "Queue name", "text", true, "orders", "", List.of()),
                        new ConsoleField("fifoQueue", "Queue type", "select", true, null, "false",
                                List.of(new ConsoleOption("false", "Standard"), new ConsoleOption("true", "FIFO"))))));

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
                "sqs-queues",
                "Queues",
                "Queue inventory with type and URL summary.",
                List.of("Name", "Type", "Visible", "Delayed", "URL"),
                queues.stream().map(queue -> new ConsoleRow(
                        queue.getQueueUrl(),
                        List.of(
                                safe(queue.getQueueName()),
                                queue.isFifo() ? "FIFO" : "Standard",
                                safe(queue.getAttributes().get("ApproximateNumberOfMessages")),
                                safe(queue.getAttributes().get("ApproximateNumberOfMessagesDelayed")),
                                safe(queue.getQueueUrl())),
                        List.of(new ConsoleRowAction("open-resource", "Open", "secondary")))).toList(),
                "No queues created yet."));
        if (selectedQueue != null) {
            tables.add(new ConsoleTable(
                    "sqs-selected-queue",
                    "Selected queue",
                    "Attribute snapshot for the selected queue.",
                    List.of("Field", "Value"),
                    List.of(
                            metadataRow("Name", safe(selectedQueue.getQueueName())),
                            metadataRow("URL", safe(selectedQueue.getQueueUrl())),
                            metadataRow("Type", selectedQueue.isFifo() ? "FIFO" : "Standard"),
                            metadataRow("VisibilityTimeout", safe(selectedQueue.getAttributes().get("VisibilityTimeout"))),
                            metadataRow("Retention", safe(selectedQueue.getAttributes().get("MessageRetentionPeriod")))),
                    "No queue selected."));
        }

        return new ConsoleServicePage(
                descriptor.externalKey(),
                displayName(descriptor.externalKey()),
                "sqs",
                "SQS Queues",
                "Create queues, then inspect queue URLs and message counters.",
                descriptor.enabled() ? "running" : "available",
                metrics,
                actions,
                tables,
                appendFlash(List.of(
                        "Small-scale AWS SQS console clone: queue list first, attribute panel on selection.",
                        "Counters come from the real SQS service state inside LCS."), flashMessage));
    }

    private ConsoleServicePage buildSnsPage(ServiceDescriptor descriptor, String resourceId, String flashMessage) {
        String region = config.defaultRegion();
        List<Topic> topics = snsService.listTopics(region).stream()
                .sorted(Comparator.comparing(Topic::getName))
                .toList();
        Topic selectedTopic = selectTopic(topics, resourceId);
        List<Subscription> subscriptions = selectedTopic == null ? List.of() : snsService.listSubscriptionsByTopic(selectedTopic.getTopicArn(), region);

        List<ConsoleMetric> metrics = List.of(
                new ConsoleMetric("topics", "Topics", String.valueOf(topics.size()), runningTone(topics.size()), "Topics available in the region."),
                new ConsoleMetric("selected-subscriptions", "Selected subscriptions", String.valueOf(subscriptions.size()), "neutral", "Subscriptions wired to the selected topic."),
                new ConsoleMetric("selected-display-name", "Display name", selectedTopic == null ? "-" : safe(selectedTopic.getAttributes().get("DisplayName")), "neutral", "Display name attribute on the selected topic."),
                new ConsoleMetric("selected-topic-type", "Selected type", selectedTopic == null ? "-" : (selectedTopic.getName().endsWith(".fifo") ? "FIFO" : "Standard"), "neutral", "FIFO vs standard topic mode."));

        List<ConsoleAction> actions = List.of(new ConsoleAction(
                "create-topic",
                "Create topic",
                "primary",
                List.of(
                        new ConsoleField("topicName", "Topic name", "text", true, "events", "", List.of()),
                        new ConsoleField("fifoTopic", "Topic type", "select", true, null, "false",
                                List.of(new ConsoleOption("false", "Standard"), new ConsoleOption("true", "FIFO"))))));

        List<ConsoleTable> tables = new ArrayList<>();
        tables.add(new ConsoleTable(
                "sns-topics",
                "Topics",
                "Topic inventory with ARN and subscription counts.",
                List.of("Name", "Type", "Subscriptions", "Created", "ARN"),
                topics.stream().map(topic -> {
                    int subscriptionCount = snsService.listSubscriptionsByTopic(topic.getTopicArn(), region).size();
                    return new ConsoleRow(
                            topic.getTopicArn(),
                            List.of(
                                    safe(topic.getName()),
                                    topic.getName().endsWith(".fifo") ? "FIFO" : "Standard",
                                    String.valueOf(subscriptionCount),
                                    formatInstant(topic.getCreatedAt()),
                                    safe(topic.getTopicArn())),
                            List.of(new ConsoleRowAction("open-resource", "Open", "secondary")));
                }).toList(),
                "No topics created yet."));
        if (selectedTopic != null) {
            tables.add(new ConsoleTable(
                    "sns-selected-topic",
                    "Selected topic",
                    "Attribute snapshot for the selected topic.",
                    List.of("Field", "Value"),
                    List.of(
                            metadataRow("Name", safe(selectedTopic.getName())),
                            metadataRow("ARN", safe(selectedTopic.getTopicArn())),
                            metadataRow("Type", selectedTopic.getName().endsWith(".fifo") ? "FIFO" : "Standard"),
                            metadataRow("Display name", safe(selectedTopic.getAttributes().get("DisplayName"))),
                            metadataRow("Owner", safe(selectedTopic.getAttributes().get("Owner")))),
                    "No topic selected."));
            tables.add(new ConsoleTable(
                    "sns-subscriptions",
                    "Subscriptions",
                    "Subscriptions attached to the selected topic.",
                    List.of("Protocol", "Endpoint", "Subscription ARN"),
                    subscriptions.stream().map(subscription -> new ConsoleRow(
                            subscription.getSubscriptionArn(),
                            List.of(
                                    safe(subscription.getProtocol()),
                                    safe(subscription.getEndpoint()),
                                    safe(subscription.getSubscriptionArn())),
                            List.of())).toList(),
                    "No subscriptions for this topic yet."));
        }

        return new ConsoleServicePage(
                descriptor.externalKey(),
                displayName(descriptor.externalKey()),
                "sns",
                "SNS Topics",
                "Create topics, then inspect subscriptions and topic attributes.",
                descriptor.enabled() ? "running" : "available",
                metrics,
                actions,
                tables,
                appendFlash(List.of(
                        "AWS SNS console pattern in small scale: topic list first, subscription panel on selection.",
                        "Subscription counts and attribute panels are read from the real SNS service state."), flashMessage));
    }

    private ConsoleServicePage buildGenericPage(ServiceDescriptor descriptor, String flashMessage) {
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
                appendFlash(List.of(
                        "This service no longer dead-ends in the home panel. It now has a dedicated console page route.",
                        "Next step for this service: wire its primary list/create flows into first-class widgets."), flashMessage));
    }

    private ActionResult applyEc2Action(String actionId, Map<String, Object> request) {
        String region = config.defaultRegion();
        return switch (actionId) {
            case "launch-instance" -> {
                String nameTag = stringValue(request, "nameTag");
                String imageId = defaultIfBlank(stringValue(request, "imageId"), "ami-default");
                String instanceType = defaultIfBlank(stringValue(request, "instanceType"), "t2.micro");
                String keyName = blankToNull(stringValue(request, "keyName"));
                String subnetId = blankToNull(stringValue(request, "subnetId"));
                String securityGroupId = blankToNull(stringValue(request, "securityGroupId"));
                List<Tag> tags = nameTag == null || nameTag.isBlank() ? List.of() : List.of(new Tag("Name", nameTag));
                Reservation reservation = ec2Service.runInstances(
                        region,
                        imageId,
                        instanceType,
                        1,
                        1,
                        keyName,
                        securityGroupId == null ? List.of() : List.of(securityGroupId),
                        subnetId,
                        null,
                        tags,
                        null,
                        null);
                String instanceId = reservation.getInstances().isEmpty() ? null : reservation.getInstances().get(0).getInstanceId();
                yield new ActionResult(instanceId, "Launched EC2 instance " + safe(instanceId) + ".");
            }
            case "start-instance" -> {
                String instanceId = required(request, "resourceId");
                ec2Service.startInstances(region, List.of(instanceId));
                yield new ActionResult(instanceId, "Started EC2 instance " + instanceId + ".");
            }
            case "stop-instance" -> {
                String instanceId = required(request, "resourceId");
                ec2Service.stopInstances(region, List.of(instanceId));
                yield new ActionResult(instanceId, "Stopped EC2 instance " + instanceId + ".");
            }
            case "terminate-instance" -> {
                String instanceId = required(request, "resourceId");
                ec2Service.terminateInstances(region, List.of(instanceId));
                yield new ActionResult(instanceId, "Terminated EC2 instance " + instanceId + ".");
            }
            case "create-key-pair" -> {
                String keyName = required(request, "keyName");
                KeyPair keyPair = ec2Service.createKeyPair(region, keyName);
                yield new ActionResult(null, "Created key pair " + keyPair.getKeyName() + ".");
            }
            case "allocate-address" -> {
                Address address = ec2Service.allocateAddress(region);
                yield new ActionResult(address.getAllocationId(), "Allocated Elastic IP " + safe(address.getPublicIp()) + " (" + safe(address.getAllocationId()) + ").");
            }
            case "associate-address" -> {
                String allocationId = required(request, "allocationId");
                String instanceId = required(request, "instanceId");
                Address address = ec2Service.associateAddress(region, allocationId, instanceId);
                yield new ActionResult(allocationId, "Associated Elastic IP " + safe(address.getPublicIp()) + " with instance " + safe(instanceId) + ".");
            }
            case "disassociate-address" -> {
                String associationId = required(request, "resourceId");
                ec2Service.disassociateAddress(region, associationId);
                yield new ActionResult(null, "Disassociated Elastic IP association " + associationId + ".");
            }
            case "release-address" -> {
                String allocationId = required(request, "resourceId");
                ec2Service.releaseAddress(region, allocationId);
                yield new ActionResult(null, "Released Elastic IP allocation " + allocationId + ".");
            }
            case "create-volume" -> {
                String nameTag = blankToNull(stringValue(request, "nameTag"));
                String availabilityZone = defaultIfBlank(stringValue(request, "availabilityZone"), region + "a");
                String volumeType = defaultIfBlank(stringValue(request, "volumeType"), "gp3");
                int size = intValue(request, "size", 8);
                List<Tag> volumeTags = nameTag == null ? List.of() : List.of(new Tag("Name", nameTag));
                // snapshotId is null: this console flow creates empty volumes only.
                Volume volume = ec2Service.createVolume(region, availabilityZone, volumeType, size, false, 0, null, null, volumeTags);
                yield new ActionResult(volume.getVolumeId(), "Created volume " + safe(volume.getVolumeId()) + " in " + safe(volume.getAvailabilityZone()) + ".");
            }
            case "delete-volume" -> {
                String volumeId = required(request, "resourceId");
                ec2Service.deleteVolume(region, volumeId);
                yield new ActionResult(null, "Deleted volume " + volumeId + ".");
            }
            case "create-load-balancer" -> {
                String loadBalancerName = required(request, "loadBalancerName");
                String scheme = defaultIfBlank(stringValue(request, "scheme"), "internet-facing");
                String subnetId = blankToNull(stringValue(request, "subnetId"));
                String subnetId2 = blankToNull(stringValue(request, "subnetId2"));
                String securityGroupId = blankToNull(stringValue(request, "securityGroupId"));
                String targetGroupName = defaultIfBlank(stringValue(request, "targetGroupName"), loadBalancerName + "-tg");
                int listenerPort = intValue(request, "listenerPort", 80);
                int targetPort = intValue(request, "targetPort", 80);
                String targetInstanceId = blankToNull(stringValue(request, "targetInstanceId"));

                List<String> subnetIds = new ArrayList<>();
                if (subnetId != null) {
                    subnetIds.add(subnetId);
                }
                if (subnetId2 != null && !subnetIds.contains(subnetId2)) {
                    subnetIds.add(subnetId2);
                }
                if (subnetIds.isEmpty()) {
                    throw new BadRequestException("Create load balancer requires at least one subnet.");
                }

                List<Vpc> vpcs = ec2Service.describeVpcs(region, List.of(), Map.of());
                String vpcId = vpcs.isEmpty() ? "vpc-00000001" : safe(vpcs.get(0).getVpcId());
                LoadBalancer loadBalancer = elbV2Service.createLoadBalancer(
                        region,
                        loadBalancerName,
                        scheme,
                        "application",
                        "ipv4",
                        subnetIds,
                        securityGroupId == null ? List.of() : List.of(securityGroupId),
                        Map.of());
                TargetGroup targetGroup = elbV2Service.createTargetGroup(
                        region,
                        targetGroupName,
                        "HTTP",
                        "HTTP1",
                        targetPort,
                        vpcId,
                        "instance",
                        null,
                        null,
                        null,
                        "/",
                        null,
                        null,
                        null,
                        null,
                        "200",
                        "ipv4",
                        Map.of());

                io.github.hectorvent.floci.services.elbv2.model.Action defaultAction = new io.github.hectorvent.floci.services.elbv2.model.Action();
                defaultAction.setType("forward");
                defaultAction.setOrder(1);
                defaultAction.setTargetGroupArn(targetGroup.getTargetGroupArn());

                elbV2Service.createListener(
                        region,
                        loadBalancer.getLoadBalancerArn(),
                        "HTTP",
                        listenerPort,
                        null,
                        List.of(),
                        List.of(defaultAction),
                        List.of(),
                        Map.of());

                if (targetInstanceId != null) {
                    TargetDescription target = new TargetDescription();
                    target.setId(targetInstanceId);
                    target.setPort(targetPort);
                    elbV2Service.registerTargets(region, targetGroup.getTargetGroupArn(), List.of(target));
                }

                yield new ActionResult(loadBalancer.getLoadBalancerArn(), "Created application load balancer " + safe(loadBalancer.getLoadBalancerName()) + " with target group " + safe(targetGroup.getTargetGroupName()) + ".");
            }
            case "delete-load-balancer" -> {
                String loadBalancerArn = required(request, "resourceId");
                elbV2Service.deleteLoadBalancer(region, loadBalancerArn);
                yield new ActionResult(null, "Deleted load balancer " + loadBalancerArn + ".");
            }
            default -> throw new BadRequestException("Unsupported EC2 console action: " + actionId);
        };
    }

    private ActionResult applyIamAction(String actionId, Map<String, Object> request) {
        return switch (actionId) {
            case "create-user" -> {
                String userName = required(request, "userName");
                String path = defaultIfBlank(stringValue(request, "path"), "/");
                IamUser user = iamService().createUser(userName, path);
                yield new ActionResult(iamUserResourceId(user.getUserName()), "Created IAM user " + user.getUserName() + ".");
            }
            case "create-group" -> {
                String groupName = required(request, "groupName");
                String path = defaultIfBlank(stringValue(request, "path"), "/");
                IamGroup group = iamService().createGroup(groupName, path);
                yield new ActionResult(iamGroupResourceId(group.getGroupName()), "Created IAM group " + group.getGroupName() + ".");
            }
            case "create-role" -> {
                String roleName = required(request, "roleName");
                String path = defaultIfBlank(stringValue(request, "path"), "/");
                String description = blankToNull(stringValue(request, "description"));
                String assumeRolePolicyDocument = defaultIfBlank(stringValue(request, "assumeRolePolicyDocument"), defaultIamAssumeRolePolicy());
                int maxSessionDuration = intValue(request, "maxSessionDuration", 3600);
                IamRole role = iamService().createRole(roleName, path, assumeRolePolicyDocument, description, maxSessionDuration, Map.of());
                yield new ActionResult(iamRoleResourceId(role.getRoleName()), "Created IAM role " + role.getRoleName() + ".");
            }
            case "create-instance-profile" -> {
                String instanceProfileName = required(request, "instanceProfileName");
                String path = defaultIfBlank(stringValue(request, "path"), "/");
                InstanceProfile profile = iamService().createInstanceProfile(instanceProfileName, path);
                yield new ActionResult(null, "Created instance profile " + profile.getInstanceProfileName() + ".");
            }
            case "create-access-key" -> {
                String resourceId = blankToNull(stringValue(request, "resourceId"));
                String userName = blankToNull(stringValue(request, "userName"));
                if (userName == null) {
                    userName = requiredIamResource(resourceId, "user").name();
                }
                AccessKey key = iamService().createAccessKey(userName);
                yield new ActionResult(
                    iamUserResourceId(userName),
                    "Created access key " + key.getAccessKeyId() + " for user " + userName + ". Secret access key: " + key.getSecretAccessKey());
            }
            case "attach-policy" -> {
                String targetId = blankToNull(stringValue(request, "resourceId"));
                if (targetId == null) {
                    targetId = required(request, "entityId");
                }
                IamResource target = requiredIamResource(targetId, "user", "group", "role");
                String policyArn = required(request, "policyArn");

                switch (target.type()) {
                    case "user" -> iamService().attachUserPolicy(target.name(), policyArn);
                    case "group" -> iamService().attachGroupPolicy(target.name(), policyArn);
                    case "role" -> iamService().attachRolePolicy(target.name(), policyArn);
                    default -> throw new BadRequestException("Unsupported IAM attach target: " + target.type());
                }

                yield new ActionResult(target.resourceId(), "Attached policy " + iamPolicyNameFromArn(policyArn) + " to IAM " + target.type() + " " + target.name() + ".");
            }
            case "add-role-to-instance-profile" -> {
                String resourceId = blankToNull(stringValue(request, "resourceId"));
                String roleName = blankToNull(stringValue(request, "roleName"));
                if (roleName == null) {
                    roleName = requiredIamResource(resourceId, "role").name();
                }
                String instanceProfileName = required(request, "instanceProfileName");
                iamService().addRoleToInstanceProfile(instanceProfileName, roleName);
                yield new ActionResult(iamRoleResourceId(roleName), "Added role " + roleName + " to instance profile " + instanceProfileName + ".");
            }
            default -> throw new BadRequestException("Unsupported IAM console action: " + actionId);
        };
    }

    private ActionResult applyS3Action(String actionId, Map<String, Object> request) {
        return switch (actionId) {
            case "create-bucket" -> {
                String bucketName = required(request, "bucketName");
                String region = defaultIfBlank(stringValue(request, "region"), config.defaultRegion());
                Bucket bucket = s3Service.createBucket(bucketName, region);
                yield new ActionResult(bucket.getName(), "Created bucket " + bucket.getName() + ".");
            }
            case "put-object" -> {
                String bucketName = required(request, "bucketName");
                String objectKey = required(request, "objectKey");
                String body = defaultIfBlank(stringValue(request, "body"), "");
                s3Service.putObject(bucketName, objectKey, body.getBytes(StandardCharsets.UTF_8), "text/plain", Map.of());
                yield new ActionResult(bucketName, "Uploaded object " + objectKey + " to bucket " + bucketName + ".");
            }
            default -> throw new BadRequestException("Unsupported S3 console action: " + actionId);
        };
    }

    private ActionResult applyLambdaAction(String actionId, Map<String, Object> request) {
        String region = config.defaultRegion();
        return switch (actionId) {
            case "create-function" -> {
                String functionName = required(request, "functionName");
                String runtime = defaultIfBlank(stringValue(request, "runtime"), "nodejs20.x");
                String handler = defaultIfBlank(stringValue(request, "handler"), "index.handler");
                String role = defaultIfBlank(stringValue(request, "role"), defaultLambdaRoleArn());
                Map<String, Object> createRequest = new LinkedHashMap<>();
                createRequest.put("FunctionName", functionName);
                createRequest.put("Runtime", runtime);
                createRequest.put("Role", role);
                createRequest.put("Handler", handler);
                createRequest.put("Description", "Created from LCS console");
                createRequest.put("Timeout", 3);
                createRequest.put("MemorySize", 128);
                createRequest.put("Code", Map.of("ZipFile", inlineLambdaZip(functionName)));
                LambdaFunction function = lambdaService.createFunction(region, createRequest);
                yield new ActionResult(function.getFunctionName(), "Created Lambda function " + function.getFunctionName() + ".");
            }
            case "invoke-function" -> {
                String functionName = required(request, "resourceId");
                String payload = defaultIfBlank(stringValue(request, "payload"), "{}");
                InvokeResult result = lambdaService.invoke(region, functionName, payload.getBytes(StandardCharsets.UTF_8), InvocationType.RequestResponse);
                String responsePayload = result.getPayload() == null ? "" : new String(result.getPayload(), StandardCharsets.UTF_8);
                yield new ActionResult(functionName, "Invocation result " + result.getStatusCode() + ": " + truncate(responsePayload, 240));
            }
            case "delete-function" -> {
                String functionName = required(request, "resourceId");
                lambdaService.deleteFunction(region, functionName);
                yield new ActionResult(null, "Deleted Lambda function " + functionName + ".");
            }
            default -> throw new BadRequestException("Unsupported Lambda console action: " + actionId);
        };
    }

    private ActionResult applyDynamoDbAction(String actionId, Map<String, Object> request) {
        return switch (actionId) {
            case "create-table" -> {
                String tableName = required(request, "tableName");
                String partitionKey = required(request, "partitionKey");
                String partitionType = defaultIfBlank(stringValue(request, "partitionType"), "S");
                String sortKey = blankToNull(stringValue(request, "sortKey"));
                String sortType = defaultIfBlank(stringValue(request, "sortType"), "S");

                List<KeySchemaElement> keySchema = new ArrayList<>();
                keySchema.add(new KeySchemaElement(partitionKey, "HASH"));
                List<AttributeDefinition> attributeDefinitions = new ArrayList<>();
                attributeDefinitions.add(new AttributeDefinition(partitionKey, partitionType));
                if (sortKey != null) {
                    keySchema.add(new KeySchemaElement(sortKey, "RANGE"));
                    attributeDefinitions.add(new AttributeDefinition(sortKey, sortType));
                }

                dynamoDbService.createTable(tableName, keySchema, attributeDefinitions, 5L, 5L, config.defaultRegion());
                yield new ActionResult(tableName, "Created DynamoDB table " + tableName + ".");
            }
            default -> throw new BadRequestException("Unsupported DynamoDB console action: " + actionId);
        };
    }

    private ActionResult applySqsAction(String actionId, Map<String, Object> request) {
        return switch (actionId) {
            case "create-queue" -> {
                String queueName = required(request, "queueName");
                boolean fifoQueue = Boolean.parseBoolean(defaultIfBlank(stringValue(request, "fifoQueue"), "false"));
                Map<String, String> attributes = new LinkedHashMap<>();
                if (fifoQueue) {
                    if (!queueName.endsWith(".fifo")) {
                        queueName = queueName + ".fifo";
                    }
                    attributes.put("FifoQueue", "true");
                }
                Queue queue = sqsService.createQueue(queueName, attributes, config.defaultRegion());
                yield new ActionResult(queue.getQueueUrl(), "Created SQS queue " + queue.getQueueName() + ".");
            }
            default -> throw new BadRequestException("Unsupported SQS console action: " + actionId);
        };
    }

    private ActionResult applySnsAction(String actionId, Map<String, Object> request) {
        return switch (actionId) {
            case "create-topic" -> {
                String topicName = required(request, "topicName");
                boolean fifoTopic = Boolean.parseBoolean(defaultIfBlank(stringValue(request, "fifoTopic"), "false"));
                Map<String, String> attributes = new LinkedHashMap<>();
                if (fifoTopic) {
                    if (!topicName.endsWith(".fifo")) {
                        topicName = topicName + ".fifo";
                    }
                    attributes.put("FifoTopic", "true");
                }
                Topic topic = snsService.createTopic(topicName, attributes, Map.of(), config.defaultRegion());
                yield new ActionResult(topic.getTopicArn(), "Created SNS topic " + topic.getName() + ".");
            }
            default -> throw new BadRequestException("Unsupported SNS console action: " + actionId);
        };
    }

    private List<Instance> instances(String region) {
        return ec2Service.describeInstances(region, List.of(), Map.of()).stream()
                .map(Reservation::getInstances)
                .flatMap(List::stream)
                .toList();
    }

    private ConsoleRow toEc2InstanceRow(Instance instance) {
        String state = instanceState(instance);
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
                    ec2RowActions(state),
                    1);
    }

                private ConsoleRow toInstanceVolumeRow(Volume volume, String instanceId) {
                VolumeAttachment attachment = volume.getAttachments().stream()
                    .filter(candidate -> Objects.equals(candidate.getInstanceId(), instanceId))
                    .findFirst()
                    .orElse(null);
                return new ConsoleRow(
                    volume.getVolumeId(),
                    List.of(
                        safe(volume.getVolumeId()),
                        attachment == null ? "-" : safe(attachment.getDevice()),
                        attachment == null ? safe(volume.getState()) : safe(attachment.getState()),
                        safe(volume.getVolumeType()),
                        volume.getSize() + " GiB",
                        attachment == null ? "-" : booleanLabel(attachment.isDeleteOnTermination())),
                    List.of());
                }

                private ConsoleRow toInstanceAddressRow(Address address) {
                return new ConsoleRow(
                    safe(address.getAllocationId()),
                    List.of(
                        safe(address.getPublicIp()),
                        safe(address.getAllocationId()),
                        safe(address.getAssociationId()),
                        safe(address.getDomain())),
                    elasticIpRowActions(address));
                }

                private ConsoleRow toElasticIpRow(Address address) {
                String rowId = blankToNull(address.getAssociationId()) != null ? address.getAssociationId() : safe(address.getAllocationId());
                return new ConsoleRow(
                    rowId,
                    List.of(
                        safe(address.getPublicIp()),
                        safe(address.getAllocationId()),
                        safe(address.getAssociationId()),
                        safe(address.getInstanceId()),
                        safe(address.getDomain())),
                    elasticIpRowActions(address));
                }

                private ConsoleRow toVolumeRow(Volume volume) {
                return new ConsoleRow(
                    volume.getVolumeId(),
                    List.of(
                        tagValue(volume.getTags(), "Name"),
                        safe(volume.getVolumeId()),
                        safe(volume.getState()),
                        safe(volume.getVolumeType()),
                        volume.getSize() + " GiB",
                        safe(volume.getAvailabilityZone()),
                        volume.getAttachments().isEmpty()
                            ? "-"
                            : String.join(", ", volume.getAttachments().stream()
                                .map(attachment -> safe(attachment.getInstanceId()))
                                .toList())),
                    volumeRowActions(volume));
                }

                private ConsoleRow toLoadBalancerRow(LoadBalancer loadBalancer) {
                return new ConsoleRow(
                    loadBalancer.getLoadBalancerArn(),
                    List.of(
                        safe(loadBalancer.getLoadBalancerName()),
                        safe(loadBalancer.getScheme()),
                        safe(loadBalancer.getType()),
                        safe(loadBalancer.getState()),
                        safe(loadBalancer.getDnsName()),
                        loadBalancer.getSecurityGroups().isEmpty() ? "-" : String.join(", ", loadBalancer.getSecurityGroups())),
                    List.of(new ConsoleRowAction("delete-load-balancer", "Delete", "danger")));
                }

                private ConsoleRow toTargetGroupRow(TargetGroup targetGroup, Map<String, List<String>> loadBalancerNamesByTargetGroupArn) {
                List<String> loadBalancerNames = loadBalancerNamesByTargetGroupArn.getOrDefault(targetGroup.getTargetGroupArn(), List.of());
                return new ConsoleRow(
                    targetGroup.getTargetGroupArn(),
                    List.of(
                        safe(targetGroup.getTargetGroupName()),
                        safe(targetGroup.getProtocol()),
                        targetGroup.getPort() == null ? "-" : String.valueOf(targetGroup.getPort()),
                        safe(targetGroup.getTargetType()),
                        String.valueOf(targetGroup.getTargets().size()),
                        loadBalancerNames.isEmpty() ? "-" : String.join(", ", loadBalancerNames)),
                    List.of());
                }

                private ConsoleRow toListenerRow(Listener listener,
                                 Map<String, String> loadBalancerNamesByArn,
                                 Map<String, String> targetGroupNamesByArn) {
                return new ConsoleRow(
                    listener.getListenerArn(),
                    List.of(
                        loadBalancerNamesByArn.getOrDefault(listener.getLoadBalancerArn(), safe(listener.getLoadBalancerArn())),
                        listener.getPort() == null ? "-" : String.valueOf(listener.getPort()),
                        safe(listener.getProtocol()),
                        defaultListenerAction(listener, targetGroupNamesByArn)),
                    List.of());
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

    private List<ConsoleRowAction> elasticIpRowActions(Address address) {
        if (blankToNull(address.getAssociationId()) != null) {
            return List.of(new ConsoleRowAction("disassociate-address", "Disassociate", "secondary"));
        }
        return List.of(new ConsoleRowAction("release-address", "Release", "danger"));
    }

    private List<ConsoleRowAction> volumeRowActions(Volume volume) {
        return "available".equals(safe(volume.getState()))
                ? List.of(new ConsoleRowAction("delete-volume", "Delete", "danger"))
                : List.of();
    }

    private List<ConsoleOption> buildSubnetOptions(List<Subnet> subnets) {
        return subnets.stream()
                .map(subnet -> new ConsoleOption(subnet.getSubnetId(), subnet.getSubnetId() + " · " + safe(subnet.getAvailabilityZone())))
                .toList();
    }

    private List<ConsoleOption> buildOptionalSubnetOptions(List<Subnet> subnets) {
        List<ConsoleOption> options = new ArrayList<>();
        options.add(new ConsoleOption("", "None"));
        options.addAll(buildSubnetOptions(subnets));
        return options;
    }

    private List<ConsoleOption> buildSecurityGroupOptions(List<SecurityGroup> securityGroups) {
        return securityGroups.stream()
                .map(group -> new ConsoleOption(group.getGroupId(), safe(group.getGroupName()) + " · " + group.getGroupId()))
                .toList();
    }

    private List<ConsoleOption> buildAddressOptions(List<Address> addresses) {
        return addresses.stream()
                .filter(address -> blankToNull(address.getAssociationId()) == null)
                .map(address -> new ConsoleOption(address.getAllocationId(), safe(address.getPublicIp()) + " · " + safe(address.getAllocationId())))
                .toList();
    }

    private List<ConsoleOption> buildInstanceOptions(List<Instance> instances, boolean includeNoneOption) {
        List<ConsoleOption> options = new ArrayList<>();
        if (includeNoneOption) {
            options.add(new ConsoleOption("", "None"));
        }
        instances.stream()
                .filter(instance -> !"terminated".equals(instanceState(instance)))
                .map(instance -> new ConsoleOption(instance.getInstanceId(), instanceName(instance) + " · " + safe(instance.getInstanceId()) + " · " + instanceState(instance)))
                .forEach(options::add);
        return options;
    }

    private List<ConsoleOption> buildAvailabilityZoneOptions(List<Subnet> subnets, String region) {
        List<ConsoleOption> options = new ArrayList<>();
        List<String> zones = subnets.stream()
                .map(Subnet::getAvailabilityZone)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (zones.isEmpty()) {
            options.add(new ConsoleOption(region + "a", region + "a"));
            options.add(new ConsoleOption(region + "b", region + "b"));
            return options;
        }
        zones.stream().map(zone -> new ConsoleOption(zone, zone)).forEach(options::add);
        return options;
    }

    private String defaultSubnetAz(List<Subnet> subnets) {
        return subnets.stream()
                .map(Subnet::getAvailabilityZone)
                .filter(Objects::nonNull)
                .findFirst()
                .orElse(null);
    }

    private List<ConsoleOption> buildKeyPairOptions(List<KeyPair> keyPairs) {
        List<ConsoleOption> options = new ArrayList<>();
        options.add(new ConsoleOption("", "None"));
        keyPairs.stream()
                .map(keyPair -> new ConsoleOption(keyPair.getKeyName(), keyPair.getKeyName()))
                .forEach(options::add);
        return options;
    }

    private List<ConsoleAction> buildIamInventoryActions(List<IamUser> users,
                                                         List<IamGroup> groups,
                                                         List<IamRole> roles,
                                                         List<IamPolicy> policies,
                                                         List<InstanceProfile> instanceProfiles) {
        List<ConsoleAction> actions = new ArrayList<>();
        actions.add(new ConsoleAction(
            "create-user",
            "Create user",
            "primary",
            List.of(
                new ConsoleField("userName", "User name", "text", true, "alice", "", List.of()),
                new ConsoleField("path", "Path", "text", false, "/application/", "/", List.of()))));
        actions.add(new ConsoleAction(
            "create-role",
            "Create role",
            "primary",
            List.of(
                new ConsoleField("roleName", "Role name", "text", true, "ec2-app-role", "", List.of()),
                new ConsoleField("description", "Description", "text", false, "Application role for EC2 workloads", "", List.of()),
                new ConsoleField("path", "Path", "text", false, "/application/", "/", List.of()),
                new ConsoleField("maxSessionDuration", "Max session duration (seconds)", "text", false, "3600", "3600", List.of()),
                new ConsoleField("assumeRolePolicyDocument", "Trust policy", "textarea", true, null, defaultIamAssumeRolePolicy(), List.of()))));
        actions.add(new ConsoleAction(
            "create-group",
            "Create group",
            "secondary",
            List.of(
                new ConsoleField("groupName", "Group name", "text", true, "developers", "", List.of()),
                new ConsoleField("path", "Path", "text", false, "/teams/", "/", List.of()))));
        actions.add(new ConsoleAction(
            "create-instance-profile",
            "Create instance profile",
            "secondary",
            List.of(
                new ConsoleField("instanceProfileName", "Instance profile name", "text", true, "ec2-app-profile", "", List.of()),
                new ConsoleField("path", "Path", "text", false, "/application/", "/", List.of()))));
        if (!users.isEmpty()) {
            actions.add(new ConsoleAction(
                "create-access-key",
                "Create access key",
                "secondary",
                List.of(new ConsoleField("userName", "User", "select", true, null, users.get(0).getUserName(), buildIamUserOptions(users)))));
        }

        List<ConsoleOption> entityOptions = buildIamEntityOptions(users, groups, roles);
        if (!entityOptions.isEmpty() && !policies.isEmpty()) {
            actions.add(new ConsoleAction(
                "attach-policy",
                "Attach managed policy",
                "secondary",
                List.of(
                    new ConsoleField("entityId", "Entity", "select", true, null, entityOptions.get(0).value(), entityOptions),
                    new ConsoleField("policyArn", "Policy", "select", true, null, policies.get(0).getArn(), buildIamPolicyOptions(policies)))));
        }

        if (!roles.isEmpty() && !instanceProfiles.isEmpty()) {
            actions.add(new ConsoleAction(
                "add-role-to-instance-profile",
                "Add role to instance profile",
                "secondary",
                List.of(
                    new ConsoleField("instanceProfileName", "Instance profile", "select", true, null, instanceProfiles.get(0).getInstanceProfileName(), buildIamInstanceProfileOptions(instanceProfiles)),
                    new ConsoleField("roleName", "Role", "select", true, null, roles.get(0).getRoleName(), buildIamRoleOptions(roles)))));
        }

        return actions;
    }

    private ConsoleField hiddenResourceField(String resourceId) {
        return new ConsoleField("resourceId", "Resource", "text", false, null, resourceId, List.of());
    }

    private ConsoleRow toIamUserRow(IamUser user) {
        return new ConsoleRow(
            iamUserResourceId(user.getUserName()),
            List.of(
                safe(user.getUserName()),
                safe(user.getUserId()),
                safe(user.getPath()),
                String.valueOf(user.getGroupNames().size()),
                String.valueOf(user.getAttachedPolicyArns().size()),
                formatInstant(user.getCreateDate())),
            List.of(new ConsoleRowAction("create-access-key", "Create access key", "secondary")),
            0);
    }

    private ConsoleRow toIamGroupRow(IamGroup group) {
        return new ConsoleRow(
            iamGroupResourceId(group.getGroupName()),
            List.of(
                safe(group.getGroupName()),
                safe(group.getGroupId()),
                safe(group.getPath()),
                String.valueOf(group.getUserNames().size()),
                String.valueOf(group.getAttachedPolicyArns().size()),
                formatInstant(group.getCreateDate())),
            List.of(),
            0);
    }

    private ConsoleRow toIamRoleRow(IamRole role) {
        return new ConsoleRow(
            iamRoleResourceId(role.getRoleName()),
            List.of(
                safe(role.getRoleName()),
                safe(role.getRoleId()),
                safe(role.getPath()),
                String.valueOf(role.getAttachedPolicyArns().size()),
                formatDurationSeconds(role.getMaxSessionDuration()),
                formatInstant(role.getCreateDate())),
            List.of(),
            0);
    }

    private ConsoleRow toIamPolicyInventoryRow(IamPolicy policy) {
        return new ConsoleRow(
            safe(policy.getArn()),
            List.of(
                safe(policy.getPolicyName()),
                iamPolicyScope(policy),
                safe(policy.getPath()),
                String.valueOf(policy.getAttachmentCount()),
                safe(policy.getDefaultVersionId()),
                truncate(safe(policy.getArn()), 84)),
            List.of());
    }

    private ConsoleRow toIamInstanceProfileRow(InstanceProfile profile) {
        return new ConsoleRow(
            safe(profile.getInstanceProfileName()),
            List.of(
                safe(profile.getInstanceProfileName()),
                safe(profile.getInstanceProfileId()),
                safe(profile.getPath()),
                joinOrDash(profile.getRoleNames()),
                formatInstant(profile.getCreateDate())),
            List.of());
    }

    private ConsoleRow toIamAccessKeyRow(AccessKey key) {
        return new ConsoleRow(
            safe(key.getAccessKeyId()),
            List.of(
                safe(key.getAccessKeyId()),
                safe(key.getStatus()),
                formatInstant(key.getCreateDate())),
            List.of());
    }

    private ConsoleRow toIamMembershipGroupRow(IamGroup group) {
        return new ConsoleRow(
            iamGroupResourceId(group.getGroupName()),
            List.of(
                safe(group.getGroupName()),
                safe(group.getGroupId()),
                safe(group.getPath()),
                String.valueOf(group.getAttachedPolicyArns().size())),
            List.of(),
            0);
    }

    private ConsoleRow toIamGroupUserRow(IamUser user) {
        return new ConsoleRow(
            iamUserResourceId(user.getUserName()),
            List.of(
                safe(user.getUserName()),
                safe(user.getUserId()),
                safe(user.getPath()),
                String.valueOf(user.getGroupNames().size()),
                String.valueOf(user.getAttachedPolicyArns().size()),
                formatInstant(user.getCreateDate())),
            List.of(),
            0);
    }

    private ConsoleRow toIamAttachedPolicyRow(IamPolicy policy) {
        return new ConsoleRow(
            safe(policy.getArn()),
            List.of(
                safe(policy.getPolicyName()),
                iamPolicyScope(policy),
                String.valueOf(policy.getAttachmentCount()),
                safe(policy.getDefaultVersionId()),
                truncate(safe(policy.getArn()), 84)),
            List.of());
    }

    private List<ConsoleOption> buildIamUserOptions(List<IamUser> users) {
        return users.stream()
            .map(user -> new ConsoleOption(user.getUserName(), user.getUserName()))
            .toList();
    }

    private List<ConsoleOption> buildIamRoleOptions(List<IamRole> roles) {
        return roles.stream()
            .map(role -> new ConsoleOption(role.getRoleName(), role.getRoleName()))
            .toList();
    }

    private List<ConsoleOption> buildIamInstanceProfileOptions(List<InstanceProfile> instanceProfiles) {
        return instanceProfiles.stream()
            .map(profile -> new ConsoleOption(profile.getInstanceProfileName(), profile.getInstanceProfileName()))
            .toList();
    }

    private List<ConsoleOption> buildIamPolicyOptions(List<IamPolicy> policies) {
        return policies.stream()
            .map(policy -> new ConsoleOption(policy.getArn(), safe(policy.getPolicyName()) + " · " + iamPolicyScope(policy)))
            .toList();
    }

    private List<ConsoleOption> buildIamEntityOptions(List<IamUser> users, List<IamGroup> groups, List<IamRole> roles) {
        List<ConsoleOption> options = new ArrayList<>();
        users.stream()
            .map(user -> new ConsoleOption(iamUserResourceId(user.getUserName()), "User · " + safe(user.getUserName())))
            .forEach(options::add);
        groups.stream()
            .map(group -> new ConsoleOption(iamGroupResourceId(group.getGroupName()), "Group · " + safe(group.getGroupName())))
            .forEach(options::add);
        roles.stream()
            .map(role -> new ConsoleOption(iamRoleResourceId(role.getRoleName()), "Role · " + safe(role.getRoleName())))
            .forEach(options::add);
        return options;
    }

    private IamUser selectIamUser(List<IamUser> users, String resourceId) {
        IamResource resource = parseIamResource(resourceId);
        if (resource == null || !"user".equals(resource.type())) {
            return null;
        }
        return users.stream()
            .filter(user -> Objects.equals(user.getUserName(), resource.name()))
            .findFirst()
            .orElse(null);
    }

    private IamGroup selectIamGroup(List<IamGroup> groups, String resourceId) {
        IamResource resource = parseIamResource(resourceId);
        if (resource == null || !"group".equals(resource.type())) {
            return null;
        }
        return groups.stream()
            .filter(group -> Objects.equals(group.getGroupName(), resource.name()))
            .findFirst()
            .orElse(null);
    }

    private IamRole selectIamRole(List<IamRole> roles, String resourceId) {
        IamResource resource = parseIamResource(resourceId);
        if (resource == null || !"role".equals(resource.type())) {
            return null;
        }
        return roles.stream()
            .filter(role -> Objects.equals(role.getRoleName(), resource.name()))
            .findFirst()
            .orElse(null);
    }

    private IamResource parseIamResource(String resourceId) {
        String candidate = blankToNull(resourceId);
        if (candidate == null) {
            return null;
        }
        int separator = candidate.indexOf(':');
        if (separator <= 0 || separator == candidate.length() - 1) {
            return null;
        }
        return new IamResource(candidate.substring(0, separator), candidate.substring(separator + 1));
    }

    private IamResource requiredIamResource(String resourceId, String... supportedTypes) {
        IamResource resource = parseIamResource(resourceId);
        if (resource == null) {
            throw new BadRequestException("Invalid IAM resource identifier.");
        }
        for (String supportedType : supportedTypes) {
            if (supportedType.equals(resource.type())) {
                return resource;
            }
        }
        throw new BadRequestException("Unsupported IAM resource identifier: " + resourceId);
    }

    private String iamUserResourceId(String userName) {
        return "user:" + userName;
    }

    private String iamGroupResourceId(String groupName) {
        return "group:" + groupName;
    }

    private String iamRoleResourceId(String roleName) {
        return "role:" + roleName;
    }

    private String iamPolicyScope(IamPolicy policy) {
        return policy.getArn() != null && policy.getArn().startsWith("arn:aws:iam::aws:policy")
            ? "AWS managed"
            : "Customer managed";
    }

    private String iamPolicyNameFromArn(String policyArn) {
        String candidate = blankToNull(policyArn);
        if (candidate == null) {
            return "-";
        }
        int separator = candidate.lastIndexOf('/');
        return separator < 0 ? candidate : candidate.substring(separator + 1);
    }

    private String formatDurationSeconds(int seconds) {
        if (seconds <= 0) {
            return "-";
        }
        if (seconds % 3600 == 0) {
            return (seconds / 3600) + "h";
        }
        if (seconds % 60 == 0) {
            return (seconds / 60) + "m";
        }
        return seconds + "s";
    }

    private String defaultIamAssumeRolePolicy() {
        return """
            {
              \"Version\": \"2012-10-17\",
              \"Statement\": [
                {
                  \"Effect\": \"Allow\",
                  \"Principal\": {
                    \"Service\": \"ec2.amazonaws.com\"
                  },
                  \"Action\": \"sts:AssumeRole\"
                }
              ]
            }
            """.trim().replace("\\\"", "\"");
    }

    private List<ConsoleDetailItem> buildTagItems(Map<String, String> tags) {
        if (tags.isEmpty()) {
            return List.of(detailItem("Tag set", "No tags"));
        }
        return tags.entrySet().stream()
            .sorted(Map.Entry.comparingByKey())
            .map(entry -> detailItem(entry.getKey(), safe(entry.getValue())))
            .toList();
    }

    private ConsoleRow metadataRow(String field, String value) {
        return new ConsoleRow(field.toLowerCase().replace(' ', '-'), List.of(field, value), List.of());
    }

    private Bucket selectBucket(List<Bucket> buckets, String resourceId) {
        if (buckets.isEmpty()) {
            return null;
        }
        if (resourceId == null || resourceId.isBlank()) {
            return buckets.get(0);
        }
        return buckets.stream().filter(bucket -> Objects.equals(bucket.getName(), resourceId)).findFirst().orElse(buckets.get(0));
    }

    private LambdaFunction selectFunction(List<LambdaFunction> functions, String resourceId) {
        if (functions.isEmpty()) {
            return null;
        }
        if (resourceId == null || resourceId.isBlank()) {
            return functions.get(0);
        }
        return functions.stream().filter(function -> Objects.equals(function.getFunctionName(), resourceId)).findFirst().orElse(functions.get(0));
    }

    private Queue selectQueue(List<Queue> queues, String resourceId) {
        if (queues.isEmpty()) {
            return null;
        }
        if (resourceId == null || resourceId.isBlank()) {
            return queues.get(0);
        }
        return queues.stream().filter(queue -> Objects.equals(queue.getQueueUrl(), resourceId)).findFirst().orElse(queues.get(0));
    }

    private Topic selectTopic(List<Topic> topics, String resourceId) {
        if (topics.isEmpty()) {
            return null;
        }
        if (resourceId == null || resourceId.isBlank()) {
            return topics.get(0);
        }
        return topics.stream().filter(topic -> Objects.equals(topic.getTopicArn(), resourceId)).findFirst().orElse(topics.get(0));
    }

    private String selectName(List<String> values, String resourceId) {
        if (values.isEmpty()) {
            return null;
        }
        if (resourceId == null || resourceId.isBlank()) {
            return values.get(0);
        }
        return values.contains(resourceId) ? resourceId : values.get(0);
    }

    private String dynamoPrimaryKey(TableDefinition table, JsonNode item) {
        StringBuilder builder = new StringBuilder();
        builder.append(table.getPartitionKeyName()).append('=').append(dynamoValue(item.get(table.getPartitionKeyName())));
        if (table.getSortKeyName() != null) {
            builder.append(" · ").append(table.getSortKeyName()).append('=').append(dynamoValue(item.get(table.getSortKeyName())));
        }
        return builder.toString();
    }

    private String dynamoValue(JsonNode attribute) {
        if (attribute == null || !attribute.isObject()) {
            return "-";
        }
        var fields = attribute.fields();
        if (!fields.hasNext()) {
            return "-";
        }
        Map.Entry<String, JsonNode> entry = fields.next();
        JsonNode value = entry.getValue();
        if (value == null) {
            return "-";
        }
        if (value.isArray()) {
            List<String> values = new ArrayList<>();
            value.forEach(item -> values.add(item.asText()));
            return String.join(", ", values);
        }
        return value.asText(value.toString());
    }

    private String compactJson(JsonNode value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (IOException exception) {
            return value.toString();
        }
    }

    private List<String> appendFlash(List<String> notices, String flashMessage) {
        if (flashMessage == null || flashMessage.isBlank()) {
            return List.of();
        }
        return List.of(flashMessage);
    }

    private ServiceDescriptor descriptor(String serviceId) {
        return catalog.byExternalKey(serviceId)
                .orElseThrow(() -> new NotFoundException("Unknown console service: " + serviceId));
    }

    private String instanceName(Instance instance) {
        return tagValue(instance.getTags(), "Name");
    }

    private String instanceState(Instance instance) {
        return instance.getState() == null ? "unknown" : safe(instance.getState().getName());
    }

    private String instanceArn(Instance instance) {
        return "arn:aws:ec2:" + config.defaultRegion() + ":" + config.defaultAccountId() + ":instance/" + safe(instance.getInstanceId());
    }

    private ConsoleDetailGroup detailGroup(String id, String title, List<ConsoleDetailItem> items) {
        return new ConsoleDetailGroup(id, title, items);
    }

    private ConsoleDetailItem detailItem(String label, String value) {
        return new ConsoleDetailItem(label, value, "neutral");
    }

    private ConsoleDetailItem detailItem(String label, String value, String tone) {
        return new ConsoleDetailItem(label, value, tone);
    }

    private List<ConsoleDetailItem> buildNetworkInterfaceItems(Instance instance) {
        List<ConsoleDetailItem> items = new ArrayList<>();
        for (InstanceNetworkInterface networkInterface : instance.getNetworkInterfaces()) {
            String suffix = networkInterface.getDeviceIndex() == 0 ? " (primary)" : "";
            items.add(detailItem("Network interface" + suffix, safe(networkInterface.getNetworkInterfaceId())));
            items.add(detailItem("Subnet", safe(networkInterface.getSubnetId())));
            items.add(detailItem("VPC", safe(networkInterface.getVpcId())));
            items.add(detailItem("Private IPv4", safe(networkInterface.getPrivateIpAddress())));
            items.add(detailItem("Private DNS", safe(networkInterface.getPrivateDnsName())));
            items.add(detailItem("Security groups", joinOrDash(networkInterface.getGroups().stream().map(group -> safe(group.getGroupName()) + " (" + safe(group.getGroupId()) + ")").toList())));
        }
        if (items.isEmpty()) {
            return List.of(detailItem("Network interfaces", "No interfaces recorded"));
        }
        return items;
    }

    private List<ConsoleDetailItem> buildTagItems(List<Tag> tags) {
        if (tags.isEmpty()) {
            return List.of(detailItem("Tags", "No tags"));
        }
        return tags.stream()
                .sorted(Comparator.comparing(Tag::getKey))
                .map(tag -> detailItem(safe(tag.getKey()), safe(tag.getValue())))
                .toList();
    }

    private String publicIpForInstance(Instance instance, List<Address> attachedAddresses) {
        if (!attachedAddresses.isEmpty()) {
            return attachedAddresses.get(0).getPublicIp();
        }
        return instance.getPublicIpAddress();
    }

    private String joinGroupIdentifiers(Instance instance) {
        return joinOrDash(instance.getSecurityGroups().stream()
                .map(group -> safe(group.getGroupName()) + " (" + safe(group.getGroupId()) + ")")
                .toList());
    }

    private String joinOrDash(List<String> values) {
        List<String> filtered = values.stream()
                .filter(Objects::nonNull)
                .filter(value -> !value.isBlank())
                .toList();
        return filtered.isEmpty() ? "-" : String.join(", ", filtered);
    }

    private String firstNonBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private String booleanLabel(boolean value) {
        return value ? "Enabled" : "Disabled";
    }

    private String tagValue(List<Tag> tags, String key) {
        return tags.stream()
                .filter(tag -> key.equals(tag.getKey()))
                .map(tag -> safe(tag.getValue()))
                .findFirst()
                .orElse("-");
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

    private String formatInstant(Instant instant) {
        return instant == null ? "-" : TIMESTAMP_FORMAT.format(instant);
    }

    private String formatEpochMillis(long epochMillis) {
        return epochMillis <= 0 ? "-" : formatInstant(Instant.ofEpochMilli(epochMillis));
    }

    private String stringValue(Map<String, Object> request, String key) {
        Object value = request == null ? null : request.get(key);
        return value == null ? null : value.toString();
    }

    private int intValue(Map<String, Object> request, String key, int fallback) {
        String value = blankToNull(stringValue(request, key));
        if (value == null) {
            return fallback;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException exception) {
            throw new BadRequestException("Invalid integer for field: " + key);
        }
    }

    private String required(Map<String, Object> request, String key) {
        String value = blankToNull(stringValue(request, key));
        if (value == null) {
            throw new BadRequestException("Missing required field: " + key);
        }
        return value;
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private String defaultIfBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }

    private String truncate(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return safe(value);
        }
        return value.substring(0, maxLength - 3) + "...";
    }

    private String defaultListenerAction(Listener listener, Map<String, String> targetGroupNamesByArn) {
        if (listener.getDefaultActions().isEmpty()) {
            return "-";
        }
        io.github.hectorvent.floci.services.elbv2.model.Action action = listener.getDefaultActions().get(0);
        if (blankToNull(action.getTargetGroupArn()) != null) {
            return "Forward -> " + targetGroupNamesByArn.getOrDefault(action.getTargetGroupArn(), safe(action.getTargetGroupArn()));
        }
        return safe(action.getType());
    }

    private String defaultLambdaRoleArn() {
        return "arn:aws:iam::" + config.defaultAccountId() + ":role/lcs-console-lambda-role";
    }

    private String inlineLambdaZip(String functionName) {
        String code = "exports.handler = async (event) => ({ ok: true, functionName: \"" + escapeJavaScript(functionName)
                + "\", echo: event });\n";

        try {
            ByteArrayOutputStream byteStream = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(byteStream)) {
                zip.putNextEntry(new ZipEntry("index.js"));
                zip.write(code.getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
            return Base64.getEncoder().encodeToString(byteStream.toByteArray());
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to build inline Lambda deployment package", exception);
        }
    }

    private String escapeJavaScript(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private record IamResource(String type, String name) {
        private String resourceId() {
            return type + ":" + name;
        }
    }

    private record ActionResult(String resourceId, String message) {
    }
}