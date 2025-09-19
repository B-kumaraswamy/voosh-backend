import axios from "axios";
import cron from "cron";
import "dotenv/config";

// Fetch the API URL from environment variables
const apiUrl = process.env.BACKEND_ORIGIN;
// Cron job to run every 14 minutes
const job = new cron.CronJob("*/14 * * * *", async function () {
  try {
    const response = await axios.get(`${apiUrl}/health`);
    if (response.status === 200) {
      console.log(
        "GET request sent successfully at:",
        new Date().toLocaleString()
      );
    } else {
      console.log("GET request failed with status code:", response.status);
    }
  } catch (error) {
    console.error("Error during API request:", error.message);
  }
});

// Start the cron job
job.start();

// Export the job if needed (e.g., for testing purposes)
export default job;

/* CRON JOB EXPLANATION:
 Cron jobs are scheduled tasks that run periodically at fixed intervals
 we want to send 1 GET request for every 14 minutes so that our api never gets inactive on Render.com

 How to define a "Schedule"?
 You define a schedule using a cron expression, which consists of 5 fields representing:

! MINUTE, HOUR, DAY OF THE MONTH, MONTH, DAY OF THE WEEK

 EXAMPLES && EXPLANATION:
//* 14 * * * * - Every 14 minutes
//* 0 0 * * 0 - At midnight on every Sunday
//* 30 3 15 * * - At 3:30 AM, on the 15th of every month
//* 0 0 1 1 * - At midnight, on January 1st
//* 0 * * * * - Every hour */
