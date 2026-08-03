/**
 * DocumentDB cluster and instance integration tests.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  DocDBClient,
  CreateDBClusterCommand,
  DescribeDBClustersCommand,
  DeleteDBClusterCommand,
  CreateDBInstanceCommand,
  DescribeDBInstancesCommand,
  DeleteDBInstanceCommand,
} from '@aws-sdk/client-docdb';
import { makeClient, uniqueName } from './setup';

const docdb = makeClient(DocDBClient);

async function deleteCluster(id: string) {
  try {
    await docdb.send(new DeleteDBClusterCommand({ DBClusterIdentifier: id, SkipFinalSnapshot: true }));
  } catch { /* ignore */ }
}

async function deleteInstance(id: string) {
  try {
    await docdb.send(new DeleteDBInstanceCommand({ DBInstanceIdentifier: id }));
  } catch { /* ignore */ }
}

describe('DocDB Clusters', () => {
  let clusterId: string;

  afterEach(async () => {
    if (clusterId) {
      await deleteCluster(clusterId);
      clusterId = '';
    }
  });

  it('should create and describe a cluster', async () => {
    clusterId = `node-cl-${uniqueName()}`;

    const response = await docdb.send(new CreateDBClusterCommand({
      DBClusterIdentifier: clusterId,
      Engine: 'docdb',
      MasterUsername: 'docdbadmin',
      MasterUserPassword: 'secret99password',
    }));
    const cluster = response.DBCluster!;
    expect(cluster.DBClusterIdentifier).toBe(clusterId);
    expect(cluster.Engine).toBe('docdb');
    expect(cluster.Status).toBe('available');

    const descResp = await docdb.send(new DescribeDBClustersCommand({
      DBClusterIdentifier: clusterId,
    }));
    expect(descResp.DBClusters).toHaveLength(1);
  });

  it('should report cluster members after adding an instance', async () => {
    clusterId = `node-cl-${uniqueName()}`;
    const instanceId = `node-inst-${uniqueName()}`;

    await docdb.send(new CreateDBClusterCommand({
      DBClusterIdentifier: clusterId,
      Engine: 'docdb',
      MasterUsername: 'docdbadmin',
      MasterUserPassword: 'secret99password',
    }));

    try {
      await docdb.send(new CreateDBInstanceCommand({
        DBInstanceIdentifier: instanceId,
        DBClusterIdentifier: clusterId,
        DBInstanceClass: 'db.r5.large',
        Engine: 'docdb',
      }));

      const descResp = await docdb.send(new DescribeDBInstancesCommand({
        DBInstanceIdentifier: instanceId,
      }));
      expect(descResp.DBInstances).toHaveLength(1);

      // DBClusterMemberList declares an explicit member locationName of
      // DBClusterMember. botocore falls back to <member> and parses either
      // spelling, but this SDK is strict and silently drops mismatched entries,
      // so an empty DBClusterMembers here means the wire format is wrong.
      const clusterResp = await docdb.send(new DescribeDBClustersCommand({
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
