const jobCreator = require('./job-creator');

const no_delay = 0;
const long_delay = 1000;

module.exports.sync = function(mondego){
    return new Promise((ff,rj)=>{
      report(mondego);
      mondego.forEachDriver(driver=>fireConsumer(driver,no_delay));
      loadState(mondego);
    });
};

function loadState(mondego){
  mondego.queue(jobCreator.newRepoSync(mondego,undefined,undefined));
}

function fireConsumer(driver,delay){
  setTimeout(()=>{
    let isRetry = false;
    let job = driver.pendingJobs.shift();
    if(!job){
      job = driver.failedJobs.shift();
      isRetry = true;
    }
    if(!job) {
      return fireConsumer(driver,long_delay);
    }
    job.fire(driver).then(
      driverResult=>{
        try{
          job.accept(driver, driverResult);
        } catch(ex){
          console.error("Error accepting data: " + ex);
        } finally {
          fireConsumer(driver,no_delay);
        }
      },
      ko=>{
        console.error("Job '" + job.name + "' failed on driver " + driver.id + ": " + ko)
        driver.failedJobs.push(job);
        fireConsumer(driver, isRetry ? long_delay : no_delay);
      }
    )},delay);
}

function report(mondego){
  setTimeout(
    ()=>{
      mondego.forEachDriver(driver=>{
        console.log("Driver " + driver.id + " has " + driver.pendingJobs.length + " pending jobs");
        console.log("Driver " + driver.id + " has " + driver.failedJobs.length + " failed pending jobs");
      });
      report(mondego);
    },5000);
}
