import * as core from '@actions/core'
import * as github from '@actions/github'

const urlParse =
  /\/(?<ownerType>orgs|users)\/(?<ownerName>[^/]+)\/projects\/(?<projectNumber>\d+)/

interface ProjectNodeIDResponse {
  organization?: {
    projectV2: {
      id: string
    }
  }

  user?: {
    projectV2: {
      id: string
    }
  }
}

interface ProjectAddItemResponse {
  addProjectV2ItemById: {
    item: {
      id: string
    }
  }
}

interface ProjectV2AddDraftIssueResponse {
  addProjectV2DraftIssue: {
    projectItem: {
      id: string
    }
  }
}

export function getFieldValue(
  labelsMap: string | undefined,
  issueLabels: string[]
): [string | null, string | null] {
  if (typeof labelsMap !== 'string') {
    return [null, null]
  }
  try {
    const labelsMapObject = JSON.parse(labelsMap)
    const labelNames = Object.keys(labelsMapObject)
    for (const value of Object.values(labelsMapObject)) {
      core.info(
        `Value: ${JSON.stringify(
          value
        )} (${typeof value}), labels: ${issueLabels}`
      )
      for (const label of issueLabels) {
        core.info(
          `Label: ${label} (${typeof label}), type of issueLabels: ${typeof issueLabels}`
        )
      }
      if (Array.isArray(value)) {
        for (const label of value) {
          if (issueLabels.includes(label.label)) {
            core.info(`Returning <${label.fieldValue}>`)
            return [labelNames[0], label.fieldValue]
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.error(`Error parsing label map: ${error.message}`)
    } else {
      core.error(`Error parsing label map: ${error}`)
    }
  }

  return [null, null]
}

export async function addToProject(): Promise<void> {
  const projectUrl = core.getInput('project-url', {required: true})
  const ghToken = core.getInput('github-token', {required: true})
  const labeled =
    core
      .getInput('labeled')
      .split(',')
      .map(l => l.trim().toLowerCase())
      .filter(l => l.length > 0) ?? []
  const labelOperator = core
    .getInput('label-operator')
    .trim()
    .toLocaleLowerCase()

  const octokit = github.getOctokit(ghToken)

  const issue =
    github.context.payload.issue ?? github.context.payload.pull_request
  const issueLabels: string[] = (issue?.labels ?? []).map((l: {name: string}) =>
    l.name.toLowerCase()
  )
  const issueOwnerName = github.context.payload.repository?.owner.login

  const labelsMapInput = core.getInput('label-map', {required: false})

  core.info(`Issue/PR owner: ${issueOwnerName}`)
  core.info(`Issue/PR labels: ${issueLabels.join(', ')}`)
  core.debug(`Issue/PR owner: ${issueOwnerName}`)
  core.debug(`Issue/PR labels: ${issueLabels.join(', ')}`)

  core.info(
    `Getting field value from label map: ${labelsMapInput}, labels: ${issueLabels}`
  )

  const [customFieldName, customFieldValue] = getFieldValue(
    labelsMapInput,
    issueLabels
  )

  core.info(`Custom field name: ${customFieldName}, value: ${customFieldValue}`)

  // Ensure the issue matches our `labeled` filter based on the label-operator.
  if (labelOperator === 'and') {
    if (!labeled.every(l => issueLabels.includes(l))) {
      core.info(
        `Skipping issue ${
          issue?.number
        } because it doesn't match all the labels: ${labeled.join(', ')}`
      )
      return
    }
  } else if (labelOperator === 'not') {
    if (labeled.length > 0 && issueLabels.some(l => labeled.includes(l))) {
      core.info(
        `Skipping issue ${
          issue?.number
        } because it contains one of the labels: ${labeled.join(', ')}`
      )
      return
    }
  } else {
    if (labeled.length > 0 && !issueLabels.some(l => labeled.includes(l))) {
      core.info(
        `Skipping issue ${
          issue?.number
        } because it does not have one of the labels: ${labeled.join(', ')}`
      )
      return
    }
  }

  core.debug(`Project URL: ${projectUrl}`)

  const urlMatch = projectUrl.match(urlParse)

  if (!urlMatch) {
    throw new Error(
      `Invalid project URL: ${projectUrl}. Project URL should match the format <GitHub server domain name>/<orgs-or-users>/<ownerName>/projects/<projectNumber>`
    )
  }

  const projectOwnerName = urlMatch.groups?.ownerName
  const projectNumber = parseInt(urlMatch.groups?.projectNumber ?? '', 10)
  const ownerType = urlMatch.groups?.ownerType
  const ownerTypeQuery = mustGetOwnerTypeQuery(ownerType)

  core.debug(`Project owner: ${projectOwnerName}`)
  core.debug(`Project number: ${projectNumber}`)
  core.debug(`Project owner type: ${ownerType}`)

  // First, use the GraphQL API to request the project's node ID.
  const idResp = await octokit.graphql<ProjectNodeIDResponse>(
    `query getProject($projectOwnerName: String!, $projectNumber: Int!) {
      ${ownerTypeQuery}(login: $projectOwnerName) {
        projectV2(number: $projectNumber) {
          id
        }
      }
    }`,
    {
      projectOwnerName,
      projectNumber
    }
  )

  const projectId = idResp[ownerTypeQuery]?.projectV2.id
  const contentId = issue?.node_id

  core.info(`Project node ID: ${projectId}`)
  core.info(`Content ID: ${contentId}`)

  // Then, get the ID of the custom field
  const customFieldResp = await octokit.graphql<any>(
    `query getCustomField($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id
                  name
                  options {
                    id
                    name
                  }
                }
              }
            }
          }
        }
      }`,
    {
      projectId
    }
  )
  core.info(
    `Requested custom field: ${JSON.stringify(customFieldResp)} using the ID: ${projectId}`
  )
  core.info(
    `Custom field ID: ${customFieldResp?.node?.fields?.nodes}, ${JSON.stringify(
      customFieldResp
    )}`
  )
  const customFieldNode = customFieldResp?.node?.fields?.nodes?.filter(
    (node: {name: string; id: string; options: unknown[]}) =>
      node?.name === customFieldName
  )[0]

  core.info(`Custom field Node: ${JSON.stringify(customFieldNode)}`)
  const customFieldId = customFieldNode?.id
  core.info(`Probably the field ID: ${customFieldId}}`)

  const customFieldOptions = customFieldNode?.options
  const customFieldValueObject = customFieldOptions?.filter((option: {name: string, id: string }) => option.name === customFieldValue )[0]
  const customFieldValueId = customFieldValueObject?.id

  core.info(`Custom field value ID: ${JSON.stringify(customFieldValueId)}`)

  // Next, use the GraphQL API to add the issue to the project.
  // If the issue has the same owner as the project, we can directly
  // add a project item. Otherwise, we add a draft issue.
  if (issueOwnerName === projectOwnerName) {
    core.info('Creating project item')

    const addResp = await octokit.graphql<ProjectAddItemResponse>(
      `mutation addIssueToProject($input: AddProjectV2ItemByIdInput!) {
        addProjectV2ItemById(input: $input) {
          item {
            id
          }
        }
      }`,
      {
        input: {
          projectId,
          contentId
        }
      }
    )

    const itemId = addResp.addProjectV2ItemById.item.id

    core.info(`Will set field values using item ID: ${itemId}, project ID: ${projectId}, customFieldId: ${customFieldId}, fieldValue: ${customFieldValueId}`)

    const setFieldValue = await octokit.graphql<any>(
      `mutation (
        $projectId: ID!
        $itemId: ID!
        $customFieldId: ID!
        $customFieldValueId: String!
      ) {
        set_priority_field: updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $customFieldId
          value: {
            singleSelectOptionId: $customFieldValueId
            }
        }) {
          projectV2Item {
            id
            }
        }
      }`,
      {
        projectId,
        itemId,
        customFieldId,
        customFieldValueId
      }
    )

    core.info(`Set field value: ${JSON.stringify(setFieldValue)}`)

    core.setOutput('itemId', itemId)
  } else {
    core.info('Creating draft issue in project')

    const addResp = await octokit.graphql<ProjectV2AddDraftIssueResponse>(
      `mutation addDraftIssueToProject($projectId: ID!, $title: String!) {
        addProjectV2DraftIssue(input: {
          projectId: $projectId,
          title: $title
        }) {
          projectItem {
            id
          }
        }
      }`,
      {
        projectId,
        title: issue?.html_url
      }
    )

    core.setOutput('itemId', addResp.addProjectV2DraftIssue.projectItem.id)
  }
}

export function mustGetOwnerTypeQuery(
  ownerType?: string
): 'organization' | 'user' {
  const ownerTypeQuery =
    ownerType === 'orgs'
      ? 'organization'
      : ownerType === 'users'
      ? 'user'
      : null

  if (!ownerTypeQuery) {
    throw new Error(
      `Unsupported ownerType: ${ownerType}. Must be one of 'orgs' or 'users'`
    )
  }

  return ownerTypeQuery
}
