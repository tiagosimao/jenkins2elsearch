const configLoader = require('./config-loader');
const dataSyncer = require('./worker');
const uuidv4 = require('uuid/v4');

module.exports.loadSourceDriver = (config)=>{
  return loadDriver("source-driver:" + config.id, config.module, config.workers, config.settings);
};

module.exports.loadDestinationDriver = (config)=>{
  return loadDriver("destination-driver", config.module, config.workers, config.settings);
};

module.exports.loadStateDriver = (config)=>{
  return loadDriver("state-driver", config.module, config.workers, config.settings);
};

module.exports.boot = () => {
  return bootAll();
};

module.exports.queueJob = queueJob;
module.exports.pickupJob = pickupJob;
module.exports.resolveJob = resolveJob;
module.exports.rejectJob = rejectJob;
module.exports.forEachDriver = forEachDriver;
module.exports.loadState = loadState;
module.exports.saveState = saveState;

const mondego = {
  drivers: [],
  state: {
    pending: {},
    running: {},
    ran: {},
    errored: {},
    retried: {}
  }
};

const resumeState = {
  pending: {}
}

const repoBootstrap = {
  "method": "syncRepo"
};
const pipeBootstrap = {
  "method": "syncPipeline"
};

function loadState(){
  mondego.drivers.forEach(driver=>{
    if(driver.id=="state-driver"){
      driver.module.getState().then(
        state=>{
          mondego.drivers.forEach(driver=>{
            if(state.pending && state.pending[driver.id]){
              const jobs = state.pending[driver.id];
              console.log("Loading previous state on driver " + driver.id + ": " + jobs.length + " jobs");
              jobs.forEach(job=>{
                queueJob(driver.id,job);
              });
            }
          });
        },
        nothin=>{
          console.log("No previous state found, bootstrapping: " + nothin);
          queueJob(/source.*/,repoBootstrap);
          queueJob(/source.*/,pipeBootstrap);
        }
      );
    }
  });
}

function saveState(){
  mondego.drivers.forEach(driver=>{
    if(driver.id=="state-driver"){
      driver.module.setState(resumeState);
    }
  });
}

function validateJob(job){
  if(job&&job.id&&job.method){
    return job;
  }
  console.trace("Invalid job: " + JSON.stringify(job));
  return undefined;
}

function getJobIndex(queue,job){
  if(!queue||!job){
    return -1;
  }
  for(let i=0;i<queue.length;++i){
    if(queue[i].id==job.id){
      return i;
    }
  }
  return -1;
}

function addJob(state,queue,driverId,job){
  if(!state[queue]){
    state[queue]=[];
  }
  if(!state[queue][driverId]){
    state[queue][driverId]=[];
  }
  state[queue][driverId].push(job);
}

function moveJob(state,from,to,driverId,job){
  const queue = state[from] ? state[from][driverId] : undefined;
  if(!job){
    job = queue ? queue.shift() : undefined;
  } else {
    const at = getJobIndex(queue,job);
    if(at>-1){
      queue.splice(at,1);
    } else {
      job=undefined;
    }
  }
  if(job && to){
    addJob(state,to,driverId,job);
  }
  return job;
}

function queueJob(driverId,job) {
  if(!job.id){
    job.id=uuidv4();
  }
  const validJob = validateJob(job);
  if(validJob){
    forEachDriver((driver)=>{
      if(driver.id==driverId || driver.id.match(driverId)){
        const at = getJobIndex(mondego.state.pending[driver.id],validJob);
        if(at>-1){
          console.error("Job already queued");
        } else {

          addJob(mondego.state,"pending",driver.id,validJob);
          addJob(resumeState,"pending",driver.id,validJob);
        }
      }
    });
  } else {
    console.error("Invalid job submission: " + JSON.stringify(job));
  }
}

function pickupJob(driverId) {
  return new Promise((ff,rj)=>{
    const job = moveJob(mondego.state,"pending","running",driverId,undefined);
    if(job) {
      ff(job);
    } else {
      rj();
    }
  });
}

function resolveJob(driverId,job) {
  return new Promise((ff,rj)=>{
    const got = moveJob(mondego.state,"running","ran",driverId,job);
    if(resumeState.pending[driverId].length>1){
      // not removing last job forces mondego to pick up from there on re-run
      moveJob(resumeState,"pending",undefined,driverId,job);
    }
    if(got){
      ff();
    } else {
      rj("No such job was running on driver " + driverId + ": " + JSON.stringify(job));
    }
  });
}

function rejectJob(driverId,job) {
  return new Promise((ff,rj)=>{
    const got = moveJob(mondego.state,"running","pending",driverId,job);
    if(got){
      if(got.errorCount&&got.errorCount>0){
        addJob(mondego.state,"retried",driverId,job);
      } else {
        addJob(mondego.state,"errored",driverId,job);
      }
      got.errorCount = got.errorCount ? (got.errorCount+1) : 1;
      ff();
    } else {
      rj("No such job was running on driver " + driverId + ": " + JSON.stringify(job));
    }
  });
}

function forEachDriver(consumer){
  mondego.drivers.forEach((driver)=>consumer(driver));
}

function loadDriver(id, modulePath, workers, settings){
  return new Promise((ff,rj)=>{
    try {
      delete require.cache[require.resolve(modulePath)]
      const code = require(modulePath);
      mondego.drivers.push({
        "id": id,
        "module": code,
        "workers": workers,
        "settings": settings
      });
      ff(mondego);
    } catch(e){
      console.error("Error loading driver " + id + " at " + modulePath + ": " + e);
      rj();
    }
  });
}

function bootAll(){
  return new Promise((ff,rj)=>{
    const pees = mondego.drivers.filter((driver)=>{
      if(!driver.module.setup){
        console.warn("Warning: no setup method found for driver " + driver.id);
      }
      return driver.module.setup;
    })
    .map((driver)=>{
      const p = driver.module.setup(driver.settings);
      p.then(
        ok=>console.log("Driver boot completed [" + driver.id + "]: " + ok),
        ko=>console.error("Driver boot error [" + driver.id + "]: " + ko)
      );
    })
    Promise.all(pees).then(ok=>ff(mondego),ko=>rj(ko));
  });
}

const progress=['|','/','-','\\'];
let reportI = 0;
function report(){
  setTimeout(()=>{
    reportI = (reportI + 1)%4;
  //  process.stdout.write('\x1B[2J\x1B[0f');

    console.log("- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -");
    console.log(" " + progress[reportI] + "\tdriver\t\t\t\t\t\t\t\trunning\tpending\tran\terrored\tretried");
    mondego.drivers.forEach((driver)=>{
      const pending = mondego.state.pending[driver.id] ? mondego.state.pending[driver.id] : [];
      const running = mondego.state.running[driver.id] ? mondego.state.running[driver.id] : [];
      const ran = mondego.state.ran[driver.id] ? mondego.state.ran[driver.id] : [];
      const errored = mondego.state.errored[driver.id] ? mondego.state.errored[driver.id] : [];
      const retried = mondego.state.retried[driver.id] ? mondego.state.retried[driver.id] : [];
      let name = driver.id.length > 64 ?
        driver.id.substring(0,64) :
        driver.id+new Array(64-driver.id.length).join(" ");
      console.log("\t" + name + "\t" + running.length + "\t" + pending.length + "\t" + ran.length+ "\t" + errored.length+ "\t" + retried.length);

    });
    report();
  },1000);
}

configLoader.load(process.argv[2])
.then(
  mondego=>{
    console.log("Loaded Mondego");
    mondego.boot().then(
      ok=>{
        console.log("Booted Mondego");
        report();
        dataSyncer.sync(mondego).then(
          ok=>console.log("Finished data sync"),
          ko=>console.error("Error syncing data: " + ko)
        )
      },
      ko=>console.log("Error loading modules: " + ko)
    );
  },
  ko=>console.error(ko)
);
