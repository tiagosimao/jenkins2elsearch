const configLoader = require('./config-loader');
const dataSyncer = require('./data-syncer');
const uuidv4 = require('uuid/v4');

module.exports.loadSourceDriver = (id,modulePath,settings)=>{
  return loadDriver("source-driver:" + id, "source-driver:" + id, modulePath, settings);
};

module.exports.loadDestinationDriver = (modulePath, settings)=>{
  return loadDriver("destination-driver", "destination-driver@" + modulePath, modulePath, settings);
};

module.exports.loadStateDriver = (modulePath, settings)=>{
  return loadDriver("state-driver", "state-driver@" + modulePath, modulePath, settings);
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
    running: {}
  }
};

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
            let jobs = [];
            if(state.pending && state.pending[driver.id]){
              jobs = jobs.concat(state.pending[driver.id]);
            }
            if(state.running && state.running[driver.id]){
              jobs = jobs.concat(state.running[driver.id]);
            }
            console.log("Loading previous state on driver " + driver.name + ": " + jobs.length + " jobs");
            mondego.state.pending[driver.id]=jobs;
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
      driver.module.setState(mondego.state);
    }
  });
}

function queueJob(driverId,job) {
  if(job){
    job.id=uuidv4();
    forEachDriver((driver)=>{
      if(driver.id==driverId || driver.id.match(driverId)){
        if(!mondego.state.pending[driver.id]){
          mondego.state.pending[driver.id]=[];
        }
        mondego.state.pending[driver.id].push(job);
      }
    });
  }
}

function pickupJob(driverId) {
  return new Promise((ff,rj)=>{
    const queue = mondego.state.pending[driverId];
    const job = queue ? queue.shift() : undefined;
    if(job) {
      if(!mondego.state.running[driverId]){
        mondego.state.running[driverId]=[];
      }
      mondego.state.running[driverId].push(job);
      ff(job);
    } else {
      rj();
    }
  });
}

function resolveJob(driverId,job) {
  return new Promise((ff,rj)=>{
    const queue = mondego.state.running[driverId];
    const at = getJobIndex(queue,job);
    if(at>-1){
      mondego.state.running[driverId].splice(at,1);
      ff();
      if(!driverId=="state-driver"){
        queueJob("state-driver",{
          "type":"saveState",
          "cursor": undefined,
          "input": mondego.state
        });
      }
    } else {
      rj("No such job was running on driver " + driverId + ": " + JSON.stringify(job));
    }
  });
}

function rejectJob(driverId,job) {
  return new Promise((ff,rj)=>{
    const queue = mondego.state.running[driverId];
    const at = getJobIndex(queue,job);
    if(at>-1){
      mondego.state.running[driverId].splice(at,1);
      job.errorCount = job.errorCount ? (job.errorCount+1) : 1;
      queueJob(driverId,job);
      ff();
    } else {
      rj("No such job was running on driver " + driverId + ": " + JSON.stringify(job));
    }
  });
}

function getJobIndex(queue,job){
  for(let i=0;i<queue.length;++i){
    if(queue[i].id==job.id){
      return i;
    }
  }
  return -1;
}

function forEachDriver(consumer){
  mondego.drivers.forEach((driver)=>consumer(driver));
}

function loadDriver(id, name, modulePath, settings){
  return new Promise((ff,rj)=>{
    try {
      delete require.cache[require.resolve(modulePath)]
      const code = require(modulePath);
      mondego.drivers.push({
        "id": id,
        "name": name,
        "module": code,
        "settings": settings
      });
      ff(mondego);
    } catch(e){
      console.error("Error loading driver " + name + " with ID " + id + " at " + modulePath + ": " + e);
      rj();
    }
  });
}

function bootAll(){
  return new Promise((ff,rj)=>{
    const pees = mondego.drivers.filter((driver)=>{
      if(!driver.module.setup){
        console.warn("Warning: no setup method found for driver at " + driver.name);
      }
      return driver.module.setup;
    })
    .map((driver)=>{
      const p = driver.module.setup(driver.settings);
      p.then(
        ok=>console.log("Driver boot completed [" + driver.name + "]: " + ok),
        ko=>console.error("Driver boot error [" + driver.name + "]: " + ko)
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
    //process.stdout.write('\x1B[2J\x1B[0f');
    console.log("- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -");
    console.log(" " + progress[reportI] + "\tdriver\t\t\t\t\t\t\t\trunning\tpending");
    mondego.drivers.forEach((driver)=>{
      const pending = mondego.state.pending[driver.id] ? mondego.state.pending[driver.id] : [];
      const running = mondego.state.running[driver.id] ? mondego.state.running[driver.id] : [];
      let name = driver.name.length > 64 ?
        driver.name.substring(0,64) :
        driver.name+new Array(64-driver.name.length).join(" ");
      console.log("\t" + name + "\t" + running.length + "\t" + pending.length);
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
