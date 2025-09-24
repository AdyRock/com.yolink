'use strict';

module.exports = {

	// Retrieve all devices with their information
	async getDeviceLog({ homey, body })
	{
		return homey.app.getDeviceList(body);
	},

	// Log lines
	async getInfoLog({ homey, query })
	{
		return homey.app.getLog();
	},

	// Clear log
	async clearLog({ homey })
	{
		return homey.app.clearLog();
	},

	// Send Log
	async SendDeviceLog({ homey, body })
	{
		return homey.app.sendLog(body);
	},

	// Send Log
	async sendInfoLog({ homey, body })
	{
		return homey.app.sendLog(body);
	},

};
