require('dotenv').config()

const fetch = require('node-fetch')
const Slack = require('slack-node')
const util = require('util')
const debug = require('debug')('debug')

const doApiKey = process.env.DO_API_KEY
const slackChannel = process.env.SLACK_CHANNEL
const slackWebhookSecret = process.env.SLACK_WEBHOOK_SECRET
const snapshotPrefix = 'gh-actions-do-snapshot'
const DO_API_BASE = 'https://api.digitalocean.com/v2'

const slack = new Slack()
slack.setWebhook(`https://hooks.slack.com/services/${slackWebhookSecret}`)

// Promisify the slack webhook method
const slackWebhook = util.promisify(slack.webhook)

const messageBUS = []

const postToSlack = async message => {
  debug(`slackChannel: ${slackChannel}`)
  debug(`message: ${message}`)
  const res = await slackWebhook({
    channel: slackChannel,
    username: 'Kokoras',
    text: message
  })
  debug('slack response', res)
}

const request = async (url, options = {}, skipJSONResponse = false) => {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${doApiKey}`
    },
    ...options
  })
  return !skipJSONResponse && res.json()
}

const getDropletByName = async dropletName => {
  messageBUS.push('Getting droplet by name')
  const resp = await request(`${DO_API_BASE}/droplets`)

  return resp.droplets.find(droplet => droplet.name === dropletName)
}

const createSnapshot = async droplet => {
  messageBUS.push('Creating snapshot')
  const res = await request(`${DO_API_BASE}/droplets/${droplet.id}/actions`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'snapshot',
      name: `${snapshotPrefix}-${Date.now()}`
    })
  })
  return res
}

const getDropletSnapshots = async droplet => {
  messageBUS.push('Getting droplet snapshots')
  const res = await request(`${DO_API_BASE}/droplets/${droplet.id}/snapshots`)

  return res.snapshots
}
const getPrefixedSnapshots = snapshots =>
  snapshots.filter(snapshot => snapshot.name.includes(snapshotPrefix))

const oldSnapshotsCleanup = async snapshots => {
  messageBUS.push('Deleting old snapshots')
  for (let i = 0; i < snapshots.length; i++) {
    await request(
      `${DO_API_BASE}/snapshots/${snapshots[i].id}`,
      {
        method: 'DELETE'
      },
      true
    )
  }
}

const main = async () => {
  const droplet = await getDropletByName(process.env.DROPLET_NAME)
  const dropletSnapshots = await getDropletSnapshots(droplet)
  const snapshotsToDelete = getPrefixedSnapshots(dropletSnapshots)

  await createSnapshot(droplet)
  await oldSnapshotsCleanup(snapshotsToDelete)

  messageBUS.push('>>> DONE')

  await postToSlack(messageBUS.join('\n'))
}

main()
