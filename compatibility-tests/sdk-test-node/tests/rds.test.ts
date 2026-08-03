/**
 * RDS cluster, instance and parameter group integration tests.
 *
 * These cover the Query-protocol list shapes that declare an explicit member
 * locationName (DBClusterMemberList -> DBClusterMember, ParametersList ->
 * Parameter). botocore falls back to <member> and parses either spelling, but
 * this SDK is strict and silently drops entries under the wrong wrapper — so an
 * empty list here means the wire format is wrong, not that the data is missing.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  RDSClient,
  CreateDBClusterCommand,
  DescribeDBClustersCommand,
  DeleteDBClusterCommand,
  CreateDBInstanceCommand,
  DescribeDBInstancesCommand,
  DeleteDBInstanceCommand,
  CreateDBClusterParameterGroupCommand,
  DeleteDBClusterParameterGroupCommand,
  ModifyDBClusterParameterGroupCommand,
  DescribeDBClusterParametersCommand,
  CreateDBParameterGroupCommand,
  DeleteDBParameterGroupCommand,
  ModifyDBParameterGroupCommand,
  DescribeDBParametersCommand,
} from '@aws-sdk/client-rds';
import { makeClient, uniqueName } from './setup';

const rds = makeClient(RDSClient);

async function deleteCluster(id: string) {
  try {
    await rds.send(new DeleteDBClusterCommand({ DBClusterIdentifier: id, SkipFinalSnapshot: true }));
  } catch { /* ignore */ }
}

async function deleteInstance(id: string) {
  try {
    await rds.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: id }));
  } catch { /* ignore */ }
}

describe('RDS Clusters', () => {
  let clusterId: string;

  afterEach(async () => {
    if (clusterId) {
      await deleteCluster(clusterId);
      clusterId = '';
    }
  });

  it('should report cluster members after adding an instance', async () => {
    clusterId = `node-cl-${uniqueName()}`;
    const instanceId = `node-inst-${uniqueName()}`;

    await rds.send(new CreateDBClusterCommand({
      DBClusterIdentifier: clusterId,
      Engine: 'aurora-postgresql',
      MasterUsername: 'rdsadmin',
      MasterUserPassword: 'secret99password',
    }));

    try {
      await rds.send(new CreateDBInstanceCommand({
        DBInstanceIdentifier: instanceId,
        DBClusterIdentifier: clusterId,
        DBInstanceClass: 'db.r5.large',
        Engine: 'aurora-postgresql',
      }));

      const descResp = await rds.send(new DescribeDBInstancesCommand({
        DBInstanceIdentifier: instanceId,
      }));
      expect(descResp.DBInstances).toHaveLength(1);

      const clusterResp = await rds.send(new DescribeDBClustersCommand({
        DBClusterIdentifier: clusterId,
      }));
      const members = clusterResp.DBClusters![0].DBClusterMembers!;
      expect(members).toHaveLength(1);
      expect(members[0].DBInstanceIdentifier).toBe(instanceId);
    } finally {
      await deleteInstance(instanceId);
    }
  });
});

describe('RDS Cluster Parameter Groups', () => {
  it('should round trip parameters through modify and describe', async () => {
    const groupName = `node-cpg-${uniqueName()}`;

    await rds.send(new CreateDBClusterParameterGroupCommand({
      DBClusterParameterGroupName: groupName,
      DBParameterGroupFamily: 'aurora-postgresql16',
      Description: 'compat test group',
    }));

    try {
      // The SDK serializes this as Parameters.Parameter.N.*, not the
      // Parameters.member.N.* spelling botocore sends.
      await rds.send(new ModifyDBClusterParameterGroupCommand({
        DBClusterParameterGroupName: groupName,
        Parameters: [
          { ParameterName: 'log_statement', ParameterValue: 'all', ApplyMethod: 'immediate' },
        ],
      }));

      const response = await rds.send(new DescribeDBClusterParametersCommand({
        DBClusterParameterGroupName: groupName,
      }));
      const parameters = response.Parameters!;
      expect(parameters).toHaveLength(1);
      expect(parameters[0].ParameterName).toBe('log_statement');
      expect(parameters[0].ParameterValue).toBe('all');
    } finally {
      try {
        await rds.send(new DeleteDBClusterParameterGroupCommand({
          DBClusterParameterGroupName: groupName,
        }));
      } catch { /* ignore */ }
    }
  });
});

describe('RDS Parameter Groups', () => {
  it('should round trip parameters through modify and describe', async () => {
    const groupName = `node-pg-${uniqueName()}`;

    await rds.send(new CreateDBParameterGroupCommand({
      DBParameterGroupName: groupName,
      DBParameterGroupFamily: 'postgres15',
      Description: 'compat test group',
    }));

    try {
      await rds.send(new ModifyDBParameterGroupCommand({
        DBParameterGroupName: groupName,
        Parameters: [
          { ParameterName: 'max_connections', ParameterValue: '200', ApplyMethod: 'immediate' },
        ],
      }));

      const response = await rds.send(new DescribeDBParametersCommand({
        DBParameterGroupName: groupName,
      }));
      const parameters = response.Parameters!;
      expect(parameters).toHaveLength(1);
      expect(parameters[0].ParameterName).toBe('max_connections');
      expect(parameters[0].ParameterValue).toBe('200');
    } finally {
      try {
        await rds.send(new DeleteDBParameterGroupCommand({
          DBParameterGroupName: groupName,
        }));
      } catch { /* ignore */ }
    }
  });
});
