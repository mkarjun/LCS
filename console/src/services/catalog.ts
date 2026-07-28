/**
 * The full service catalog — every service LCS emulates.
 *
 * This is the console "skeleton": navigation, search, and the services listing are all
 * driven from here, so every emulated service is reachable even before it has a
 * purpose-built console surface.
 *
 * `id` MUST match the service id reported by /_lcs/console/summary. `name` and
 * `category` follow AWS's own naming in the real console — the AWS user's vocabulary is
 * the point, so do not shorten or invent names here.
 */

export type ServiceCategory =
  | "Analytics"
  | "Application Integration"
  | "Business Applications"
  | "Cloud Financial Management"
  | "Compute"
  | "Containers"
  | "Database"
  | "Developer Tools"
  | "Front-end Web & Mobile"
  | "Machine Learning"
  | "Management & Governance"
  | "Networking & Content Delivery"
  | "Security, Identity, & Compliance"
  | "Storage";

/** AWS's own left-nav category order in the "All services" view. */
export const CATEGORY_ORDER: ServiceCategory[] = [
  "Analytics",
  "Application Integration",
  "Business Applications",
  "Cloud Financial Management",
  "Compute",
  "Containers",
  "Database",
  "Developer Tools",
  "Front-end Web & Mobile",
  "Machine Learning",
  "Management & Governance",
  "Networking & Content Delivery",
  "Security, Identity, & Compliance",
  "Storage",
];

export interface CatalogEntry {
  /** Service id from the emulator catalog. */
  id: string;
  /** AWS display name, e.g. "Amazon S3". */
  name: string;
  /** Short name used in navigation, e.g. "S3". */
  shortName: string;
  category: ServiceCategory;
  /** AWS's one-line description for the service. */
  description: string;
  /** Route segment under /_lcs/ui. Defaults to the service id when omitted. */
  path?: string;
}

export const SERVICE_CATALOG: CatalogEntry[] = [
  // Analytics
  { id: "athena", name: "Amazon Athena", shortName: "Athena", category: "Analytics", description: "Query data in S3 using SQL" },
  { id: "es", name: "Amazon OpenSearch Service", shortName: "OpenSearch", category: "Analytics", description: "Search, visualize, and analyze data", path: "opensearch" },
  { id: "firehose", name: "Amazon Data Firehose", shortName: "Data Firehose", category: "Analytics", description: "Load streaming data into data stores" },
  { id: "glue", name: "AWS Glue", shortName: "Glue", category: "Analytics", description: "Discover, prepare, and integrate your data" },
  { id: "kafka", name: "Amazon MSK", shortName: "MSK", category: "Analytics", description: "Fully managed Apache Kafka", path: "msk" },
  { id: "kinesis", name: "Amazon Kinesis", shortName: "Kinesis", category: "Analytics", description: "Work with real-time streaming data" },

  // Application Integration
  { id: "events", name: "Amazon EventBridge", shortName: "EventBridge", category: "Application Integration", description: "Serverless event bus service", path: "eventbridge" },
  { id: "pipes", name: "Amazon EventBridge Pipes", shortName: "EventBridge Pipes", category: "Application Integration", description: "Point-to-point event integrations" },
  { id: "scheduler", name: "Amazon EventBridge Scheduler", shortName: "EventBridge Scheduler", category: "Application Integration", description: "Create and run scheduled tasks" },
  { id: "sns", name: "Amazon SNS", shortName: "SNS", category: "Application Integration", description: "Pub/sub, SMS, email, and mobile push notifications" },
  { id: "sqs", name: "Amazon SQS", shortName: "SQS", category: "Application Integration", description: "Managed message queues" },
  { id: "states", name: "AWS Step Functions", shortName: "Step Functions", category: "Application Integration", description: "Coordinate distributed applications", path: "stepfunctions" },

  // Business Applications
  { id: "email", name: "Amazon Simple Email Service", shortName: "SES", category: "Business Applications", description: "Send and receive email", path: "ses" },

  // Cloud Financial Management
  { id: "bcm-data-exports", name: "AWS Data Exports", shortName: "Data Exports", category: "Cloud Financial Management", description: "Export billing and cost management data" },
  { id: "ce", name: "AWS Cost Explorer", shortName: "Cost Explorer", category: "Cloud Financial Management", description: "Visualize and manage your AWS costs" },
  { id: "cur", name: "AWS Cost and Usage Reports", shortName: "Cost and Usage Reports", category: "Cloud Financial Management", description: "Detailed cost and usage data" },
  { id: "pricing", name: "AWS Price List", shortName: "Price List", category: "Cloud Financial Management", description: "Query AWS service pricing" },

  // Compute
  { id: "autoscaling", name: "Amazon EC2 Auto Scaling", shortName: "Auto Scaling", category: "Compute", description: "Scale EC2 capacity automatically" },
  { id: "ec2", name: "Amazon EC2", shortName: "EC2", category: "Compute", description: "Virtual servers in the cloud" },
  { id: "lambda", name: "AWS Lambda", shortName: "Lambda", category: "Compute", description: "Run code without thinking about servers" },

  // Containers
  { id: "ecr", name: "Amazon Elastic Container Registry", shortName: "ECR", category: "Containers", description: "Store and manage container images" },
  { id: "ecs", name: "Amazon Elastic Container Service", shortName: "ECS", category: "Containers", description: "Run and manage containers" },
  { id: "eks", name: "Amazon Elastic Kubernetes Service", shortName: "EKS", category: "Containers", description: "Managed Kubernetes" },

  // Database
  { id: "dynamodb", name: "Amazon DynamoDB", shortName: "DynamoDB", category: "Database", description: "Managed NoSQL database" },
  { id: "elasticache", name: "Amazon ElastiCache", shortName: "ElastiCache", category: "Database", description: "In-memory caching service" },
  { id: "neptune", name: "Amazon Neptune", shortName: "Neptune", category: "Database", description: "Fully managed graph database" },
  { id: "rds", name: "Amazon RDS", shortName: "RDS", category: "Database", description: "Managed relational database service" },

  // Developer Tools
  { id: "codebuild", name: "AWS CodeBuild", shortName: "CodeBuild", category: "Developer Tools", description: "Build and test code" },
  { id: "codedeploy", name: "AWS CodeDeploy", shortName: "CodeDeploy", category: "Developer Tools", description: "Automate code deployments" },

  // Front-end Web & Mobile
  { id: "apigateway", name: "Amazon API Gateway", shortName: "API Gateway", category: "Front-end Web & Mobile", description: "Build, deploy, and manage APIs" },
  { id: "apigatewayv2", name: "Amazon API Gateway v2", shortName: "API Gateway v2", category: "Front-end Web & Mobile", description: "HTTP and WebSocket APIs" },

  // Machine Learning
  { id: "bedrock-runtime", name: "Amazon Bedrock", shortName: "Bedrock", category: "Machine Learning", description: "Build with foundation models" },
  { id: "textract", name: "Amazon Textract", shortName: "Textract", category: "Machine Learning", description: "Extract text and data from documents" },
  { id: "transcribe", name: "Amazon Transcribe", shortName: "Transcribe", category: "Machine Learning", description: "Automatic speech recognition" },

  // Management & Governance
  { id: "appconfig", name: "AWS AppConfig", shortName: "AppConfig", category: "Management & Governance", description: "Create and manage application configurations" },
  { id: "appconfigdata", name: "AWS AppConfig Data", shortName: "AppConfig Data", category: "Management & Governance", description: "Retrieve application configuration" },
  { id: "backup", name: "AWS Backup", shortName: "Backup", category: "Management & Governance", description: "Centrally manage and automate backups" },
  { id: "cloudformation", name: "AWS CloudFormation", shortName: "CloudFormation", category: "Management & Governance", description: "Model and provision resources with templates" },
  { id: "config", name: "AWS Config", shortName: "Config", category: "Management & Governance", description: "Track resource configuration changes" },
  { id: "logs", name: "Amazon CloudWatch Logs", shortName: "CloudWatch Logs", category: "Management & Governance", description: "Monitor, store, and access log files", path: "cloudwatch-logs" },
  { id: "monitoring", name: "Amazon CloudWatch", shortName: "CloudWatch", category: "Management & Governance", description: "Monitor resources and applications", path: "cloudwatch" },
  { id: "ssm", name: "AWS Systems Manager", shortName: "Systems Manager", category: "Management & Governance", description: "Operations management and parameter store" },
  { id: "tagging", name: "AWS Resource Groups & Tag Editor", shortName: "Resource Groups", category: "Management & Governance", description: "Organize resources with tags" },

  // Networking & Content Delivery
  { id: "cloudfront", name: "Amazon CloudFront", shortName: "CloudFront", category: "Networking & Content Delivery", description: "Global content delivery network" },
  { id: "elasticloadbalancing", name: "Elastic Load Balancing", shortName: "Load Balancing", category: "Networking & Content Delivery", description: "Distribute traffic across targets", path: "elb" },
  { id: "route53", name: "Amazon Route 53", shortName: "Route 53", category: "Networking & Content Delivery", description: "Scalable DNS and domain name registration" },

  // Security, Identity, & Compliance
  { id: "acm", name: "AWS Certificate Manager", shortName: "Certificate Manager", category: "Security, Identity, & Compliance", description: "Provision and manage SSL/TLS certificates" },
  { id: "cognito-idp", name: "Amazon Cognito", shortName: "Cognito", category: "Security, Identity, & Compliance", description: "Identity management for your apps", path: "cognito" },
  { id: "iam", name: "AWS Identity and Access Management", shortName: "IAM", category: "Security, Identity, & Compliance", description: "Manage access to AWS resources" },
  { id: "kms", name: "AWS Key Management Service", shortName: "KMS", category: "Security, Identity, & Compliance", description: "Create and control encryption keys" },
  { id: "secretsmanager", name: "AWS Secrets Manager", shortName: "Secrets Manager", category: "Security, Identity, & Compliance", description: "Rotate, manage, and retrieve secrets" },

  // Storage
  { id: "s3", name: "Amazon S3", shortName: "S3", category: "Storage", description: "Scalable storage in the cloud" },
  { id: "s3vectors", name: "Amazon S3 Vectors", shortName: "S3 Vectors", category: "Storage", description: "Vector storage and similarity search on S3" },
  { id: "transfer", name: "AWS Transfer Family", shortName: "Transfer Family", category: "Storage", description: "Managed file transfers over SFTP, FTPS, and FTP" },

  // Added by the upstream Floci merge (52 -> 68 services).
  { id: "mq", name: "Amazon MQ", shortName: "Amazon MQ", category: "Application Integration", description: "Managed message broker for RabbitMQ and ActiveMQ" },
  { id: "appsync", name: "AWS AppSync", shortName: "AppSync", category: "Front-end Web & Mobile", description: "Managed GraphQL APIs" },
  { id: "batch", name: "AWS Batch", shortName: "Batch", category: "Compute", description: "Run batch computing workloads" },
  { id: "cloudcontrol", name: "AWS Cloud Control API", shortName: "Cloud Control API", category: "Management & Governance", description: "Uniform CRUD APIs across AWS resources" },
  { id: "servicediscovery", name: "AWS Cloud Map", shortName: "Cloud Map", category: "Networking & Content Delivery", description: "Service discovery for cloud resources" },
  { id: "cloudtrail", name: "AWS CloudTrail", shortName: "CloudTrail", category: "Management & Governance", description: "Track user activity and API usage" },
  { id: "codepipeline", name: "AWS CodePipeline", shortName: "CodePipeline", category: "Developer Tools", description: "Automate continuous delivery pipelines" },
  { id: "docdb", name: "Amazon DocumentDB", shortName: "DocumentDB", category: "Database", description: "Managed document database with MongoDB compatibility" },
  { id: "elasticbeanstalk", name: "AWS Elastic Beanstalk", shortName: "Elastic Beanstalk", category: "Compute", description: "Deploy and scale web applications" },
  { id: "elasticmapreduce", name: "Amazon EMR", shortName: "EMR", category: "Analytics", description: "Managed big data platform" },
  { id: "iot", name: "AWS IoT Core", shortName: "IoT Core", category: "Application Integration", description: "Connect and manage IoT devices" },
  { id: "iotdata", name: "AWS IoT Core Data Plane", shortName: "IoT Data", category: "Application Integration", description: "Publish and subscribe to device shadows and MQTT topics" },
  { id: "lightsail", name: "Amazon Lightsail", shortName: "Lightsail", category: "Compute", description: "Simple virtual private servers" },
  { id: "memorydb", name: "Amazon MemoryDB", shortName: "MemoryDB", category: "Database", description: "Durable in-memory database with Redis compatibility" },
  { id: "rds-data", name: "Amazon RDS Data API", shortName: "RDS Data API", category: "Database", description: "Run SQL over HTTP against RDS databases" },
  { id: "wafv2", name: "AWS WAF", shortName: "WAF", category: "Security, Identity, & Compliance", description: "Protect web applications from common exploits" },
];

export function servicePath(entry: CatalogEntry): string {
  return entry.path ?? entry.id;
}

const BY_PATH = new Map(SERVICE_CATALOG.map((entry) => [servicePath(entry), entry]));
const BY_ID = new Map(SERVICE_CATALOG.map((entry) => [entry.id, entry]));

export function findByPath(path: string): CatalogEntry | undefined {
  return BY_PATH.get(path);
}

export function findById(id: string): CatalogEntry | undefined {
  return BY_ID.get(id);
}

export function servicesByCategory(): { category: ServiceCategory; services: CatalogEntry[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    services: SERVICE_CATALOG.filter((entry) => entry.category === category).sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  })).filter((group) => group.services.length > 0);
}
