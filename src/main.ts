import * as core from '@actions/core'
import {addToProject} from './add-to-project'

async function run(): Promise<void> {
  try {
    await addToProject()
    process.exit(0)
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed(`Unknown error: ${error}`)
    }
    process.exit(1)
  }
}

run()
