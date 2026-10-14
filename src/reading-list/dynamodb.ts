import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { newBookmark, type Bookmark, type NewBookmark, type ReadingListStore } from './store.js'

const partition = 'reading-list'

export class DynamoReadingList implements ReadingListStore {
  constructor(
    private tableName: string,
    private client = DynamoDBDocumentClient.from(new DynamoDBClient({})),
  ) {}

  async create(input: NewBookmark) {
    const item = newBookmark(input)
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: { pk: partition, sk: item.id, ...item },
      ConditionExpression: 'attribute_not_exists(pk)',
    }))
    return item
  }

  async list(cursor?: string) {
    const result = await this.client.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk',
      FilterExpression: 'expiresAt > :now',
      ExpressionAttributeValues: { ':pk': partition, ':now': Math.floor(Date.now() / 1000) },
      ExclusiveStartKey: cursor ? { pk: partition, sk: cursor } : undefined,
      ConsistentRead: true,
      Limit: 20,
    }))
    return {
      items: (result.Items ?? []).map(({ pk, sk, ...item }) => item as Bookmark),
      nextCursor: result.LastEvaluatedKey?.sk as string ?? null,
    }
  }

  async markRead(id: string) {
    try {
      const result = await this.client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: partition, sk: id },
        UpdateExpression: 'SET #status = :read',
        ConditionExpression: 'attribute_exists(pk) AND expiresAt > :now',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':read': 'read', ':now': Math.floor(Date.now() / 1000) },
        ReturnValues: 'ALL_NEW',
      }))
      const { pk, sk, ...item } = result.Attributes!
      return item as Bookmark
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return null
      throw error
    }
  }
}
