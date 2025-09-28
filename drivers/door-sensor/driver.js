'use strict';

const yoLinkDriver = require('../yoLinkDriver');

module.exports = class DoorSensorDriver extends yoLinkDriver
{
	/**
	 * onInit is called when the driver is initialized.
	 */
	async onInit()
	{
		this.deviceType = 'DoorSensor';
		this.homey.app.updateLog('DoorSensorDriver has been initialized');
	}

};
