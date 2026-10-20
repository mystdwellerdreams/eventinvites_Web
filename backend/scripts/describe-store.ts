import dotenv from 'dotenv'
import { reportStoreConfiguration } from '../src/utils/storage'

dotenv.config({ path: ['../.env.local', '.env.local'], quiet: true })

await reportStoreConfiguration()
